import { describe, expect, test } from "bun:test";

import {
  AgentResponseJumpState,
  autoJumpOffsetForRange,
  autoJumpOffsetForResponse,
  scrollOffsetForViewportStart,
} from "./auto-jump.ts";

describe("autoJumpOffsetForResponse", () => {
  test("does not move when the response fits in the viewport", () => {
    expect(autoJumpOffsetForResponse(20, 30, 10, 20)).toBeNull();
  });

  test("does not move when the response is shorter than the viewport", () => {
    expect(autoJumpOffsetForResponse(20, 29, 10, 19)).toBeNull();
  });

  test("positions a long response start at the top of the viewport", () => {
    expect(autoJumpOffsetForResponse(20, 45, 10, 35)).toBe(15);
  });

  test("clamps the target to the available scroll range", () => {
    expect(autoJumpOffsetForResponse(5, 30, 10, 8)).toBe(8);
  });
});

describe("autoJumpOffsetForRange", () => {
  test("ignores long tool history when the final text fits", () => {
    expect(autoJumpOffsetForRange(100, 108, 300, 10, 290)).toBeNull();
  });

  test("positions the actual text start when final text exceeds the viewport", () => {
    expect(autoJumpOffsetForRange(100, 125, 130, 10, 120)).toBe(20);
  });
});

describe("scrollOffsetForViewportStart", () => {
  test("keeps a user-locked viewport at the top when content grows after temporarily fitting", () => {
    expect(scrollOffsetForViewportStart(0, 25, 9)).toBe(16);
  });

  test("preserves an existing viewport start across transcript size changes", () => {
    expect(scrollOffsetForViewportStart(11, 40, 9)).toBe(20);
  });
});

describe("AgentResponseJumpState", () => {
  test("allows a settled jump when the user did not scroll", () => {
    const state = new AgentResponseJumpState();
    state.beginTurn();

    expect(state.completeTurn()).toBe(true);
  });

  test("suppresses the jump after any user scroll intent", () => {
    const state = new AgentResponseJumpState();
    state.beginTurn();
    state.markUserScrollIntent();

    expect(state.completeTurn()).toBe(false);
  });

  test("resets scroll suppression for the next turn", () => {
    const state = new AgentResponseJumpState();
    state.beginTurn();
    state.markUserScrollIntent();
    expect(state.completeTurn()).toBe(false);

    state.beginTurn();
    expect(state.completeTurn()).toBe(true);
  });
});
