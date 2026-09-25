# Sync

Enve Memory syncs a library between computers through a **folder you already sync**: iCloud Drive, Dropbox, OneDrive, Syncthing or a NAS share. There's no server of ours in the middle. Phones don't sync; they talk to a computer's local API (see SECURITY.md).

```bash
enve-memory sync ~/Library/Mobile\ Documents/com~apple~CloudDocs/Enve\ Memory   # set the folder and sync now
enve-memory sync                                                               # sync again
enve-memory sync off                                                           # stop (nothing is deleted)
```

The desktop app and `serve` sync every 2 minutes while a folder is set. Implementation: [`packages/core/src/sync.ts`](../packages/core/src/sync.ts). Tests: [`packages/core/test/sync.test.ts`](../packages/core/test/sync.test.ts).

## Layout of the shared folder

```
<folder>/
  devices/<device-id>/device.json               who this device is, when it last synced
  devices/<device-id>/000000001234.ndjson       segments, named by the last change sequence they cover
  blobs/<sha256>                                attachment bytes, content-addressed
```

Each device writes only its own `devices/<id>/` folder, and each segment is written to a temp file then renamed. Cloud providers therefore never see two writers on one file, which is what produces "conflicted copy" files. A segment that fails to parse (a cloud client still downloading it) is retried on the next run.

## What a record is

Every change is stamped with a **hybrid logical clock**: ISO time, a 4-digit counter, then the device id. It sorts by time, never goes backwards, and moves past any stamp the device has seen, so a machine with a slow clock still orders its later edits correctly.

A segment line holds an entity's **full current state** (or `null` for a delete) at its clock stamp:

- `project`: the whole row.
- `item`: the row, task fields, tag names and attachment rows.
- `relation`: the row.

A record also carries `base`: the version the writing device had last exchanged before it edited.

## Applying records

- Records apply projects first, then items, then relations, in clock order.
- If the local version is the same or newer, the record is skipped. Otherwise the remote state is upserted. Tags, the task, and attachments are replaced to match.
- **Concurrent edits** are when the record's `base` isn't our current version: both sides changed the entity since they last agreed. The newer stamp wins everywhere, and the losing text of a note body or a project memory is kept as a new note titled "Conflicting edit of …", filed in the same project. Other fields (title, tags, status) are last-writer-wins.
- **Deletes** are tombstones: a newer delete removes the item everywhere, and a newer edit beats an older delete.
- **Same-named projects** created on two devices before their first sync are both kept (one becomes "Garage (2)"). Nothing is merged blindly.
- Applied changes go into the change log attributed to the remote device and actor, so Activity shows what came from where, and they're never echoed back.
- Attachment bytes travel through `blobs/`. A row that arrives before its bytes gets them on a later run.

## Not synced

API client tokens, settings (fetch, AI provider, sync folder), the semantic index (each device rebuilds its own), and backups.

## Not yet

- **Encryption at rest in the shared folder:** a library passphrase, with segments and blobs sealed before they leave the machine. Until then the folder holds readable data, so use a folder only you can access.
- **Segment compaction** for very long-lived libraries.
- **A LAN peer transport** for machines without a shared folder.
