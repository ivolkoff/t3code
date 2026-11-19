const NAMED_KEYS: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  esc: "\x1b",
  escape: "\x1b",
  backspace: "\x7f",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  delete: "\x1b[3~",
};

export function encodeTerminalKey(name: string): string | undefined {
  const key = name.toLowerCase();
  const ctrl = /^ctrl-([a-z])$/.exec(key);
  if (ctrl) return String.fromCharCode(ctrl[1]!.charCodeAt(0) - 96);
  return NAMED_KEYS[key];
}
