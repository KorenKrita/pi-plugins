import { describe, expect, test } from "bun:test";

import { renderFixedEditorCluster } from "./cluster.ts";

describe("renderFixedEditorCluster footer placement", () => {
  test("keeps the native footer directly below editor-adjacent widgets", () => {
    const result = renderFixedEditorCluster({
      width: 80,
      terminalRows: 10,
      statusLines: ["working"],
      editorLines: ["editor"],
      secondaryLines: ["below widget"],
      footerLines: ["model · input/output · context"],
    });

    expect(result.lines).toEqual([
      "working",
      "editor",
      "below widget",
      "model · input/output · context",
    ]);
  });

  test("reserves room for both the focused editor and footer in a short terminal", () => {
    const result = renderFixedEditorCluster({
      width: 80,
      terminalRows: 3,
      statusLines: ["working"],
      editorLines: ["old editor line", "current editor line"],
      footerLines: ["model stats"],
    });

    expect(result.lines).toEqual(["old editor line", "model stats"]);
  });
});
