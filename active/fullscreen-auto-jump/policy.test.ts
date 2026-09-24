import { describe, expect, test } from "bun:test";

import { decideJump } from "./policy.ts";

const base = {
  rangeStart: 100,
  rangeEnd: 140,
  viewportHeight: 20,
  contentHeight: 200,
  scrollTop: 180,
  isFollowingOutput: true,
};

describe("decideJump", () => {
  test("jumps to the answer start when the answer is taller than the viewport", () => {
    expect(decideJump(base)).toEqual({ jump: true, scrollTop: 100 });
  });

  test("does nothing when the user scrolled away and did not return to the bottom", () => {
    expect(decideJump({ ...base, isFollowingOutput: false })).toEqual({
      jump: false,
      reason: "user-scrolled-away",
    });
  });

  test("does nothing when the answer already fits the viewport", () => {
    expect(decideJump({ ...base, rangeEnd: 120 })).toEqual({ jump: false, reason: "answer-fits" });
  });

  test("treats an exactly-viewport-height answer as fitting", () => {
    expect(decideJump({ ...base, rangeStart: 100, rangeEnd: 120, viewportHeight: 20 })).toEqual({
      jump: false,
      reason: "answer-fits",
    });
  });

  test("an answer whose tail is still streaming in cannot exceed the document, so it fits", () => {
    // rangeEnd is clamped to contentHeight; a range starting near the end can
    // never be taller than the remaining document.
    expect(decideJump({ ...base, rangeStart: 190, rangeEnd: 260, contentHeight: 200 })).toEqual({
      jump: false,
      reason: "answer-fits",
    });
  });

  test("reports already-there when the viewport already sits at the answer start", () => {
    expect(decideJump({ ...base, rangeStart: 100, rangeEnd: 140, scrollTop: 100 })).toEqual({
      jump: false,
      reason: "already-there",
    });
  });

  test("never targets past the document end for any in-document range", () => {
    const contentHeight = 200;
    const viewportHeight = 20;
    const maxScrollTop = contentHeight - viewportHeight;
    for (let rangeStart = 0; rangeStart <= contentHeight; rangeStart += 7) {
      const decision = decideJump({
        rangeStart,
        rangeEnd: contentHeight,
        viewportHeight,
        contentHeight,
        scrollTop: maxScrollTop,
        isFollowingOutput: true,
      });
      if (decision.jump) expect(decision.scrollTop).toBeLessThanOrEqual(maxScrollTop);
    }
  });

  test("refuses to act on a degenerate viewport", () => {
    expect(decideJump({ ...base, viewportHeight: 0 })).toEqual({ jump: false, reason: "degenerate-viewport" });
  });

  test("clamps a range that runs past the measured document", () => {
    expect(decideJump({ ...base, rangeStart: 300, rangeEnd: 400, contentHeight: 200 })).toEqual({
      jump: false,
      reason: "answer-fits",
    });
  });
});
