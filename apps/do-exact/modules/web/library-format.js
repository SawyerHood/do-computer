// A selection belongs to the browser, not the document's stored draft.
const formats = { Bold: ['**', '**'], Italic: ['*', '*'], Heading: ['## ', ''], List: ['- ', ''], Task: ['- [ ] ', ''], Code: ['`', '`'], Link: ['[', '](https://)'] };
export function create(element, props, event) {
  let command = props.marks;
  event(7);
  return {
    setProps(next) {
      if (next.marks === command) return;
      command = next.marks;
      const textarea = document.getElementById('library-editor');
      const pair = formats[command.split(':')[0]];
      if (!textarea || !pair) return;
      const { selectionStart: start, selectionEnd: end } = textarea;
      const text = next.draft ?? '';
      const chosen = text.slice(start, end) || 'text';
      event(8, text.slice(0, start) + pair[0] + chosen + pair[1] + text.slice(end));
      queueMicrotask(() => { textarea.focus(); textarea.setSelectionRange(start + pair[0].length, start + pair[0].length + chosen.length); });
    },
    destroy() {},
  };
}
