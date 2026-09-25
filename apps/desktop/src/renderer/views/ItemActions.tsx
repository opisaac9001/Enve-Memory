import type { Intent, Item } from '@enve-memory/core';
import { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../lib/api.ts';
import { INTENT_LABELS, formatReminder } from '../lib/format.ts';
import { Icon, useFeedback } from '../ui.tsx';

const QUICK_TIMES = [
  { when: 'tonight', label: 'Tonight' },
  { when: 'tomorrow', label: 'Tomorrow' },
  { when: 'this weekend', label: 'This weekend' },
  { when: 'next week', label: 'Next week' },
];

const tomorrowMorning = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
};

const useFail = () => {
  const { toast } = useFeedback();
  return (error: unknown) => toast(errorMessage(error), 'error');
};

export function PinButton({ item, compact = false }: { item: Item; compact?: boolean }) {
  const fail = useFail();
  const pinned = item.pinnedAt !== null;
  return (
    <button
      className={compact ? `icon-button ${pinned ? 'on' : ''}` : `button small ${pinned ? 'on' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin' : 'Pin'}
      title={pinned ? 'Unpin' : 'Pin'}
      onClick={(event) => {
        event.stopPropagation();
        call('items.pin', item.id, !pinned).catch(fail);
      }}
    >
      <Icon name="pin" size={compact ? 16 : 14} />
      {!compact && (pinned ? 'Pinned' : 'Pin')}
    </button>
  );
}

/** "Remind me" with the common times, a date picker, and clear. `label` switches it to a snooze button. */
export function RemindMenu({ item, compact = false, label }: { item: Item; compact?: boolean; label?: string }) {
  const { toast } = useFeedback();
  const fail = useFail();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState(tomorrowMorning);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const set = (when: string | null) => {
    setOpen(false);
    setPicking(false);
    call('items.setReminder', item.id, when).then(
      (updated) => toast(updated.remindAt ? `I’ll remind you ${formatReminder(updated.remindAt).toLowerCase()}` : 'Reminder cleared'),
      fail,
    );
  };

  const text = label ?? (item.remindAt ? formatReminder(item.remindAt) : 'Remind me');
  return (
    <div className="menu-root" ref={root} onClick={(event) => event.stopPropagation()}>
      <button
        className={compact ? `icon-button ${item.remindAt ? 'on' : ''}` : `button small ${item.remindAt ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? (item.remindAt ? `Reminder ${text}` : 'Remind me')}
        title={item.remindAt ? `Reminder: ${formatReminder(item.remindAt)}` : 'Remind me'}
        onClick={() => {
          setOpen(!open);
          setPicking(false);
        }}
      >
        <Icon name="bell" size={compact ? 16 : 14} />
        {!compact && text}
      </button>
      {open && (
        <div className="menu" role="menu">
          {QUICK_TIMES.map((t) => (
            <button key={t.when} role="menuitem" onClick={() => set(t.when)}>{t.label}</button>
          ))}
          {picking ? (
            <form
              className="menu-picker"
              onSubmit={(event) => {
                event.preventDefault();
                if (custom) set(new Date(custom).toISOString());
              }}
            >
              <input type="datetime-local" aria-label="Reminder date and time" value={custom} onChange={(event) => setCustom(event.target.value)} autoFocus />
              <button type="submit" className="button small primary">Set</button>
            </form>
          ) : (
            <button role="menuitem" onClick={() => setPicking(true)}>Pick date…</button>
          )}
          {item.remindAt && <button role="menuitem" className="danger-item" onClick={() => set(null)}>Clear reminder</button>}
        </div>
      )}
    </div>
  );
}

export function IntentChips({ item }: { item: Item }) {
  const fail = useFail();
  return (
    <div className="chips" role="group" aria-label="Intent">
      {(Object.keys(INTENT_LABELS) as Intent[]).map((intent) => (
        <button
          key={intent}
          className={`chip ${item.intent === intent ? 'active' : ''}`}
          aria-pressed={item.intent === intent}
          onClick={() => call('items.setIntent', item.id, item.intent === intent ? null : intent).catch(fail)}
        >
          {INTENT_LABELS[intent]}
        </button>
      ))}
    </div>
  );
}

export function OpenLinkButton({ item }: { item: Item }) {
  const fail = useFail();
  if (!item.url) return null;
  return (
    <button
      className="icon-button"
      aria-label="Open link"
      title="Open in browser"
      onClick={(event) => {
        event.stopPropagation();
        call('items.openUrl', item.id).catch(fail);
      }}
    >
      <Icon name="external" size={16} />
    </button>
  );
}
