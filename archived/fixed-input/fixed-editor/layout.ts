export interface Renderable {
  render(width: number): string[];
}

export interface FixedInputLayout {
  statusContainer: Renderable;
  widgetAbove: Renderable;
  editorContainer: Renderable;
  widgetBelow: Renderable;
  footer: Renderable;
}

function isRenderable(value: unknown): value is Renderable {
  return Boolean(value && typeof value === "object" && typeof (value as Renderable).render === "function");
}

export interface EditorComponentUI<T> {
  getEditorComponent(): T | undefined;
  setEditorComponent(factory: T | undefined): void;
}

export function restoreEditorFactoryIfOwned<T>(
  ui: EditorComponentUI<T>,
  installedFactory: T,
  previousFactory: T | undefined,
): boolean {
  if (ui.getEditorComponent() !== installedFactory) return false;
  ui.setEditorComponent(previousFactory);
  return true;
}

export function resolveFixedInputLayout(tui: any, editor: unknown): FixedInputLayout | null {
  const children = Array.isArray(tui?.children) ? tui.children : [];
  const editorIndex = children.findIndex(
    (candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(editor),
  );
  if (editorIndex < 2 || editorIndex + 2 >= children.length) return null;

  const layout = {
    statusContainer: children[editorIndex - 2],
    widgetAbove: children[editorIndex - 1],
    editorContainer: children[editorIndex],
    widgetBelow: children[editorIndex + 1],
    footer: children[editorIndex + 2],
  };

  return Object.values(layout).every(isRenderable) ? layout : null;
}
