import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { forceRetryMessage } from "./index";

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "test",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "error",
    errorMessage: "unexpected EOF",
    timestamp: 1,
    ...overrides,
  };
}

describe("forceRetryMessage", () => {
  it("reclassifies an unrecognized API error and preserves the original", () => {
    const result = forceRetryMessage(assistant());

    expect(result?.errorMessage).toContain("network error");
    expect(result?.content).toContainEqual({
      type: "text",
      text: "[retry-all original error]\nunexpected EOF",
    });
    expect(result?.diagnostics?.at(-1)?.error?.message).toBe("unexpected EOF");
  });

  it("forces retry even for Pi's normally non-retryable provider limits", () => {
    const result = forceRetryMessage(
      assistant({ errorMessage: "insufficient_quota: billing limit reached" }),
    );

    expect(result?.errorMessage).toBe("network error: retry-all forced retry");
  });

  it("leaves native retryable errors unchanged", () => {
    expect(forceRetryMessage(assistant({ errorMessage: "503 service unavailable" }))).toBeUndefined();
  });

  it("leaves context overflow to Pi's compaction recovery", () => {
    expect(forceRetryMessage(assistant({ errorMessage: "prompt is too long" }))).toBeUndefined();
  });

  it("does not retry user aborts or successful messages", () => {
    expect(forceRetryMessage(assistant({ stopReason: "aborted" }))).toBeUndefined();
    expect(forceRetryMessage(assistant({ stopReason: "stop", errorMessage: undefined }))).toBeUndefined();
  });
});
