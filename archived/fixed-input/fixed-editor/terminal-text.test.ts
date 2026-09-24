import { describe, expect, test } from "bun:test";

import { sanitizeTerminalText } from "./terminal-text.ts";

describe("sanitizeTerminalText", () => {
  test("removes CSI, OSC, DCS, C0, C1, and DEL controls", () => {
    const input = [
      "safe",
      "\x1b[31mred\x1b[0m",
      "\x1b]52;c;payload\x07clipboard",
      "\x1bPmalicious\x1b\\dcs",
      "\x9b31mc1-csi",
      "nul\x00bell\x07del\x7f",
    ].join("\n");

    expect(sanitizeTerminalText(input)).toBe([
      "safe",
      "red",
      "clipboard",
      "dcs",
      "c1-csi",
      "nulbelldel",
    ].join("\n"));
  });

  test("drops unterminated control strings through end of input", () => {
    expect(sanitizeTerminalText("safe\x1b]52;c;payload")).toBe("safe");
    expect(sanitizeTerminalText("safe\x1bPpayload")).toBe("safe");
    expect(sanitizeTerminalText("safe\x9d52;c;payload")).toBe("safe");
  });

  test("preserves printable Unicode, tabs, and newlines", () => {
    expect(sanitizeTerminalText("中文🙂\tvalue\nnext")).toBe("中文🙂\tvalue\nnext");
  });
});
