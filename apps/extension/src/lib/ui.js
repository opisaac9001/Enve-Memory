/** Renders a message, turning `backticked` spans into <code>. Text only, so server messages can't inject markup. */
export function renderMessage(element, text) {
  element.replaceChildren(
    ...text.split('`').map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part);
      const code = document.createElement('code');
      code.textContent = part;
      return code;
    }),
  );
}
