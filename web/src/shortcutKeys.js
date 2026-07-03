// 键盘事件 → Electron accelerator 的按键名。只覆盖常见按键（字母/数字/功能键/
// 空格/方向键/常用标点），不追求覆盖 Electron accelerator 全量按键表。
const NAMED = {
  Space: 'Space',
  Tab: 'Tab',
  Escape: 'Escape',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
}

export function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return NAMED[code] || null
}

// 人类友好展示：'Control+Shift+Space' → 'Ctrl+Shift+Space'
export function formatAccelerator(accelerator) {
  return String(accelerator || '').replace(/\bControl\b/g, 'Ctrl')
}
