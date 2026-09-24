const OSC_SEQUENCE = /(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c)/g;
const STRING_CONTROL_SEQUENCE = /(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c)/g;
const UNTERMINATED_OSC_SEQUENCE = /(?:\x1b\]|\x9d)[\s\S]*$/g;
const UNTERMINATED_STRING_CONTROL_SEQUENCE = /(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[\s\S]*$/g;
const CSI_SEQUENCE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const ESCAPE_SEQUENCE = /\x1b[ -/]*[@-~]/g;
const DISALLOWED_CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

export function sanitizeTerminalText(text: string): string {
  return text
    .replace(OSC_SEQUENCE, "")
    .replace(STRING_CONTROL_SEQUENCE, "")
    .replace(UNTERMINATED_OSC_SEQUENCE, "")
    .replace(UNTERMINATED_STRING_CONTROL_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESCAPE_SEQUENCE, "")
    .replace(DISALLOWED_CONTROLS, "");
}

export function terminalLineSignature(line: string): string {
  return sanitizeTerminalText(line).trim();
}
