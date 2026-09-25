# Sync

**Not built, on purpose.** Bad sync corrupts people's data. Until Phase 6, the desktop library is authoritative and the phone captures into it. This document records the constraints the data layer already honors, so sync doesn't need a rewrite later.

## Already in place

- **UUIDv7 ids everywhere.** Devices create objects independently without coordinating.
- **A `device_id` per library**, generated on first open.
- **A change log written in the same transaction as every mutation** (`changes`: device, actor, entity, op, new field values, timestamp). This is the replication stream.
- **Tombstones.** A hard delete leaves a `delete` change, so a peer can learn that an object is gone rather than resurrect it.
- **Append-only structures where possible.** Decisions and the change log never conflict. Only the latest-wins fields on items, tasks and projects can.

## Planned design (to be validated before building)

- **Unit of sync:** changes, not rows. Each device pulls the changes it hasn't seen, keyed by `(device_id, seq)` vector clocks.
- **Conflicts:** per-field last-writer-wins using hybrid logical clocks, not wall time. The project memory document is the exception: concurrent edits keep both versions and surface a conflict, never a silent overwrite.
- **Transports behind one `SyncProvider` interface:** LAN peer-to-peer first (the phone and the Mac on the same network), then a user-chosen folder (iCloud Drive, Syncthing, WebDAV), then an optional end-to-end encrypted relay.
- **Encryption:** payloads encrypted with a library key that the user's devices exchange in-person (QR code), so any relay only ever sees ciphertext.
- **Attachments:** content-addressed, so they transfer once and dedupe naturally.

## Rules for code written before sync exists

- Every write goes through a core service that calls `Context.record()`. Never write SQL that mutates rows outside core.
- Never reuse or renumber ids. Never derive identity from `seq`.
- New tables that hold user data need a UUIDv7 `id`, timestamps, and change-log coverage.
