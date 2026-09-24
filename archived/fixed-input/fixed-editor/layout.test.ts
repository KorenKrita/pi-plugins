import { describe, expect, test } from "bun:test";

import { resolveFixedInputLayout, restoreEditorFactoryIfOwned } from "./layout.ts";

const renderable = (children?: unknown[]) => ({ children, render: () => [] });

describe("restoreEditorFactoryIfOwned", () => {
  test("restores only while the installed factory is still current", () => {
    const previous = () => "previous";
    const installed = () => "installed";
    let current: unknown = installed;
    const ui = {
      getEditorComponent: () => current,
      setEditorComponent: (factory: unknown) => { current = factory; },
    };

    expect(restoreEditorFactoryIfOwned(ui, installed, previous)).toBe(true);
    expect(current).toBe(previous);

    const foreign = () => "foreign";
    current = foreign;
    expect(restoreEditorFactoryIfOwned(ui, installed, previous)).toBe(false);
    expect(current).toBe(foreign);
  });
});

describe("resolveFixedInputLayout", () => {
  test("accepts the expected five-slot layout around the editor", () => {
    const editor = {};
    const children = [
      renderable(),
      renderable(),
      renderable([editor]),
      renderable(),
      renderable(),
    ];

    expect(resolveFixedInputLayout({ children }, editor)).toEqual({
      statusContainer: children[0],
      widgetAbove: children[1],
      editorContainer: children[2],
      widgetBelow: children[3],
      footer: children[4],
    });
  });

  test("rejects missing neighboring slots", () => {
    const editor = {};
    expect(resolveFixedInputLayout({ children: [renderable([editor]), renderable(), renderable()] }, editor)).toBeNull();
  });

  test("rejects a neighboring component without render", () => {
    const editor = {};
    expect(resolveFixedInputLayout({
      children: [renderable(), {}, renderable([editor]), renderable(), renderable()],
    }, editor)).toBeNull();
  });
});
