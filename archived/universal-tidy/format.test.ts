import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  fullTextResult,
  secondaryDetail,
  shortPath,
  stripHashlinePrefix,
  summarizeReasoning,
  summarizeResult,
  summarizeTarget,
} from "./format";

describe("call formatting", () => {
  test("prefers common target keys and shortens home paths", () => {
    expect(summarizeTarget({ action: "read", path: "/tmp/example.ts" }, "read")).toBe("/tmp/example.ts");
    expect(summarizeTarget({ path: "/home/krita/project/file.ts" }, "read")).toBe("~/project/file.ts");
    expect(shortPath("/home/krita")).toBe("~");
  });

  test("combines search patterns and paths", () => {
    expect(summarizeTarget({ pattern: "renderResult", path: "/home/krita/project" }, "grep"))
      .toBe("“renderResult” in ~/project");
  });

  test("keeps existing reasoning separate from concrete detail", () => {
    const args = { reasoning: "confirm renderer delegation", path: "/tmp/a.ts" };
    expect(summarizeReasoning(args)).toBe("confirm renderer delegation");
    expect(secondaryDetail("read", args, true)).toBe("/tmp/a.ts");
  });

  test("does not expose common secret fields", () => {
    expect(summarizeTarget({ apiKey: "secret", mode: "fast" })).toBe("mode=fast");
  });
});

describe("result formatting", () => {
  const content = [
    { type: "text", text: "First line\nSecond line" },
    { type: "image", data: "..." },
  ];

  test("uses concise line counts for generic multiline output", () => {
    expect(summarizeResult(content)).toBe("2 lines");
  });

  test("collapses noisy long one-line success messages", () => {
    const long = "Created checkpoint with aliases, context usage, recoverability details, and a long implementation note.";
    expect(summarizeResult([{ type: "text", text: long }], false, {}, "acm_checkpoint")).toBe("done");
  });

  test("strips hashline anchors from errors", () => {
    expect(stripHashlinePrefix("RT5│# Heading")).toBe("# Heading");
    expect(summarizeResult([{ type: "text", text: "RT5│permission denied" }], true)).toBe("permission denied");
  });

  test("prefers structured external result counts", () => {
    expect(summarizeResult(content, false, { totalResults: 3 }, "web_search")).toBe("3 results");
    expect(summarizeResult(content, false, { count: 1 }, "acme_lookup")).toBe("1 result");
  });

  test("formats common built-in summaries", () => {
    expect(summarizeResult(content, false, {}, "read")).toBe("2 lines");
    expect(summarizeResult(content, false, { exitCode: 0 }, "bash")).toBe("done");
    expect(summarizeResult(content, false, { exitCode: 2 }, "bash")).toBe("exit 2");
  });

  test("summarizes edits and writes without reading their full output", () => {
    const diff = "@@ -1 +1,2 @@\n-old\n+new\n+extra";
    expect(summarizeResult([], false, { diff }, "edit")).toBe("+2/-1");
    expect(summarizeResult([], false, {}, "write", { content: "one\ntwo\n" })).toBe("2 lines");
  });

  test("preserves full text for expanded fallback", () => {
    expect(fullTextResult(content)).toBe("First line\nSecond line");
  });
});

describe("width and duration formatting", () => {
  test("uses quiet compact duration units", () => {
    expect(formatDuration(480)).toBe("<1s");
    expect(formatDuration(2400)).toBe("2.4s");
    expect(formatDuration(65_000)).toBe("1m 05s");
  });

});