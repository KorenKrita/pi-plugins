import { describe, expect, test } from "bun:test";

import { captureViewportAnchor, resolveViewportAnchor } from "./viewport-anchor.ts";

describe("viewport content anchors", () => {
  test("finds the same visible content after lines are inserted before it", () => {
    const before = ["head", "alpha", "selected", "tail"];
    const anchor = captureViewportAnchor(before, 2, 2);
    const after = ["new-1", "new-2", ...before];

    expect(resolveViewportAnchor(anchor, after, 2)).toEqual({ startLine: 4, matched: true });
  });

  test("retains the independent logical start through temporary shrink", () => {
    const anchor = captureViewportAnchor(["a", "b", "selected", "d"], 2, 2);

    expect(resolveViewportAnchor(anchor, ["tiny"], 5)).toEqual({ startLine: 0, matched: false });
    expect(resolveViewportAnchor(anchor, ["a", "b", "selected", "d", "answer-1", "answer-2"], 2))
      .toEqual({ startLine: 2, matched: true });
  });

  test("uses neighboring context to disambiguate repeated lines", () => {
    const before = ["first-a", "repeat", "first-b", "true-a", "repeat", "true-b", "tail"];
    const anchor = captureViewportAnchor(before, 4, 2);
    const after = ["inserted", "first-a", "repeat", "first-b", "true-a", "repeat", "true-b", "tail"];

    expect(resolveViewportAnchor(anchor, after, 2)).toEqual({ startLine: 5, matched: true });
  });

  test("falls back to the original logical start when content disappears", () => {
    const anchor = captureViewportAnchor(["a", "b", "selected", "d"], 2, 2);

    expect(resolveViewportAnchor(anchor, ["x", "y", "z", "answer", "tail"], 2))
      .toEqual({ startLine: 2, matched: false });
  });
});
