import { describe, expect, it } from "vite-plus/test";

import { encodeTerminalKey } from "./terminalKeys.ts";

describe("encodeTerminalKey", () => {
  it("maps key names to terminal input", () => {
    expect(
      Object.fromEntries(
        [
          "enter",
          "tab",
          "esc",
          "escape",
          "backspace",
          "space",
          "up",
          "down",
          "right",
          "left",
          "home",
          "end",
          "pageup",
          "pagedown",
          "delete",
          "ctrl-a",
          "ctrl-c",
          "ctrl-z",
        ].map((name) => [name, encodeTerminalKey(name)]),
      ),
    ).toEqual({
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
      "ctrl-a": "\x01",
      "ctrl-c": "\x03",
      "ctrl-z": "\x1a",
    });
  });

  it("rejects unknown names", () => {
    expect(encodeTerminalKey("hyper-x")).toBeUndefined();
    expect(encodeTerminalKey("ctrl-1")).toBeUndefined();
  });
});
