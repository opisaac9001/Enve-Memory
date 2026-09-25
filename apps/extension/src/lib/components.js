import { parseTags } from './api.js';

export function h(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** A tag field: Enter or comma turns text into removable chips; Backspace on empty removes the last one. */
export function tagField(container, input) {
  let tags = [];

  const render = () => {
    const chips = tags.map((tag) =>
      h('span', { className: 'chip' }, [
        `#${tag}`,
        h('button', {
          type: 'button',
          textContent: '×',
          ariaLabel: `Remove ${tag}`,
          onclick: () => {
            tags = tags.filter((t) => t !== tag);
            render();
            input.focus();
          },
        }),
      ]),
    );
    container.replaceChildren(...chips, input);
  };

  const add = (text) => {
    const added = parseTags(text);
    if (!added.length) return;
    tags = parseTags([...tags, ...added].join(','));
    render();
  };

  const commit = () => {
    const text = input.value;
    input.value = '';
    add(text);
  };

  container.addEventListener('click', (event) => event.target === container && input.focus());
  input.addEventListener('keydown', (event) => {
    // Plain Enter only commits a tag; saving takes Cmd/Ctrl+Enter, so a stray Enter can't save early.
    if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !input.value && tags.length) {
      tags = tags.slice(0, -1);
      render();
    }
  });
  input.addEventListener('input', () => input.value.includes(',') && commit());
  input.addEventListener('blur', commit);

  return {
    get tags() {
      commit();
      return tags;
    },
    add,
    clear() {
      tags = [];
      input.value = '';
      render();
    },
  };
}

/** A row of toggle chips where at most one is on. Clicking the selected chip turns it off unless `required` is set. */
export function choiceChips(container, choices, { label, onChange } = {}) {
  let value = null;
  let required = false;
  const buttons = choices.map((choice) =>
    h('button', {
      type: 'button',
      className: 'choice',
      textContent: choice.label,
      onclick: () => {
        if (value !== choice.value) set(choice.value, true);
        else if (!required) set(null, true);
      },
    }),
  );
  container.setAttribute('role', 'group');
  if (label) container.setAttribute('aria-label', label);
  container.replaceChildren(...buttons);

  function set(next, fromUser = false) {
    value = next;
    choices.forEach((choice, i) => buttons[i].setAttribute('aria-pressed', String(choice.value === value)));
    if (fromUser) onChange?.(value);
  }
  set(null);

  return {
    get value() {
      return value;
    },
    set value(next) {
      set(next);
    },
    set required(next) {
      required = next;
    },
  };
}

/**
 * The AI summary and suggested tags/project for a saved item. Suggested tags can be added one by one (works with a
 * capture-only token, since re-saving merges tags); Accept applies them all and needs the write scope.
 */
export function renderSuggestions(container, item, { canAccept, onAccept, onAddTag }) {
  const ai = item?.metadata?.ai;
  const pendingTags = ai?.tags?.filter((tag) => !item.tags.includes(tag)) ?? [];
  const pendingProject = ai?.project && !item.project ? ai.project : null;
  if (ai?.status !== 'done' || (!ai.summary && !pendingTags.length && !pendingProject)) {
    container.hidden = true;
    return;
  }
  const children = [h('p', { className: 'ai-label', textContent: 'Suggested' })];
  if (ai.summary) children.push(h('p', { className: 'ai-summary', textContent: ai.summary }));
  if (!ai.accepted && (pendingTags.length || pendingProject)) {
    const row = h('div', { className: 'ai-suggestions' });
    for (const tag of pendingTags) {
      row.append(
        h('button', {
          type: 'button',
          className: 'chip suggestion',
          textContent: `+ #${tag}`,
          title: `Add #${tag}`,
          onclick: (event) => {
            event.currentTarget.remove();
            onAddTag(tag);
          },
        }),
      );
    }
    if (pendingProject) row.append(h('span', { className: 'ai-project', textContent: `→ ${pendingProject.name}` }));
    children.push(row);
    if (canAccept) {
      children.push(h('button', { type: 'button', className: 'button small', textContent: 'Accept suggestions', onclick: onAccept }));
    }
  }
  container.replaceChildren(...children);
  container.hidden = false;
}
