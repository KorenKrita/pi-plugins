import { describe, expect, test } from "bun:test";

import { findFinalAssistantTextRange } from "./assistant-range.ts";

class Lines {
  constructor(public lines: string[]) {}
  render(): string[] { return this.lines; }
}

class Container {
  constructor(public children: any[]) {}
  render(width: number): string[] {
    return this.children.flatMap((child) => child.render(width));
  }
}

function assistant(message: any, contentChildren: any[]) {
  const contentContainer = new Container(contentChildren);
  return Object.assign(new Container([contentContainer]), {
    lastMessage: message,
    contentContainer,
  });
}

describe("findFinalAssistantTextRange", () => {
  test("starts at actual text after leading space and thinking", () => {
    const component = assistant(
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning" },
          { type: "text", text: "final answer" },
        ],
      },
      [new Lines([""]), new Lines(["thinking-1", "thinking-2"]), new Lines([""]), new Lines(["answer-1", "answer-2"])],
    );
    const root = new Container([new Lines(["before"]), component, new Lines(["after"])]);

    expect(findFinalAssistantTextRange(root, 80)).toMatchObject({
      startLine: 5,
      endLine: 7,
      lineCount: 2,
    });
  });

  test("chooses the last assistant component containing text", () => {
    const earlier = assistant(
      { role: "assistant", content: [{ type: "text", text: "earlier" }] },
      [new Lines([""]), new Lines(["earlier"])],
    );
    const toolOnly = assistant(
      { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
      [],
    );
    const final = assistant(
      { role: "assistant", content: [{ type: "text", text: "final" }] },
      [new Lines([""]), new Lines(["final-1", "final-2", "final-3"])],
    );
    const root = new Container([earlier, toolOnly, final]);

    expect(findFinalAssistantTextRange(root, 80)).toMatchObject({
      startLine: 3,
      endLine: 6,
      lineCount: 3,
    });
  });

  test("does not fall back to earlier text when the latest assistant message is an error", () => {
    const earlier = assistant(
      { role: "assistant", content: [{ type: "text", text: "earlier long answer" }] },
      [new Lines([""]), new Lines(["earlier-1", "earlier-2", "earlier-3"])],
    );
    const error = assistant(
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "OpenAI API error (403)",
      },
      [],
    );
    const root = new Container([earlier, error]);

    expect(findFinalAssistantTextRange(root, 80)).toBeNull();
  });

  test("recomputes the range from current render width", () => {
    const responsiveText = { render: (width: number) => width < 40 ? ["a", "b", "c"] : ["a"] };
    const component = assistant(
      { role: "assistant", content: [{ type: "text", text: "responsive" }] },
      [new Lines([""]), responsiveText],
    );
    const root = new Container([component]);

    expect(findFinalAssistantTextRange(root, 80)?.lineCount).toBe(1);
    expect(findFinalAssistantTextRange(root, 30)?.lineCount).toBe(3);
  });
});
