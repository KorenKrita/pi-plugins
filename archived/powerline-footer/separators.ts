import type { SeparatorDef, StatusLineSeparatorStyle } from "./types.ts";

const SLASH_SEPARATOR: SeparatorDef = {
  left: " / ",
  right: " / ",
};

export function getSeparator(_style: StatusLineSeparatorStyle): SeparatorDef {
  return SLASH_SEPARATOR;
}
