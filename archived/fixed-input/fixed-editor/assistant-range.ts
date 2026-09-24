interface Renderable {
  render(width: number): string[];
  children?: unknown[];
}

export interface AssistantTextRange {
  startLine: number;
  endLine: number;
  lineCount: number;
  component: Renderable;
  message: any;
}

function isRenderable(value: unknown): value is Renderable {
  return Boolean(value && typeof value === "object" && typeof (value as Renderable).render === "function");
}

function visibleAssistantContent(content: any): boolean {
  return (content?.type === "text" && typeof content.text === "string" && content.text.trim().length > 0)
    || (content?.type === "thinking" && typeof content.thinking === "string" && content.thinking.trim().length > 0);
}

function textChildrenForAssistant(component: any): Renderable[] {
  const message = component?.lastMessage;
  const contentChildren = component?.contentContainer?.children;
  if (message?.role !== "assistant" || !Array.isArray(message.content) || !Array.isArray(contentChildren)) {
    return [];
  }

  const hasVisibleContent = message.content.some(visibleAssistantContent);
  let childIndex = hasVisibleContent ? 1 : 0;
  const textChildren: Renderable[] = [];

  for (let index = 0; index < message.content.length; index++) {
    const content = message.content[index];
    if (content?.type === "text" && typeof content.text === "string" && content.text.trim()) {
      const child = contentChildren[childIndex];
      if (isRenderable(child)) textChildren.push(child);
      childIndex += 1;
      continue;
    }

    if (content?.type === "thinking" && typeof content.thinking === "string" && content.thinking.trim()) {
      childIndex += 1;
      const hasVisibleAfter = message.content.slice(index + 1).some(visibleAssistantContent);
      if (hasVisibleAfter) childIndex += 1;
    }
  }

  return textChildren;
}

function collectAssistantComponents(root: Renderable): Renderable[] {
  const result: Renderable[] = [];
  const visit = (component: Renderable) => {
    if (textChildrenForAssistant(component).length > 0) result.push(component);
    if (!Array.isArray(component.children)) return;
    for (const child of component.children) {
      if (isRenderable(child)) visit(child);
    }
  };
  visit(root);
  return result;
}

function findLastAssistantComponent(root: Renderable): Renderable | null {
  let last: Renderable | null = null;
  const visit = (component: Renderable) => {
    if ((component as any)?.lastMessage?.role === "assistant") last = component;
    if (!Array.isArray(component.children)) return;
    for (const child of component.children) {
      if (isRenderable(child)) visit(child);
    }
  };
  visit(root);
  return last;
}

function findRenderStart(root: Renderable, target: Renderable, width: number, startLine = 0): number | null {
  if (root === target) return startLine;
  if (!Array.isArray(root.children)) return null;

  let childStart = startLine;
  for (const child of root.children) {
    if (!isRenderable(child)) continue;
    const found = findRenderStart(child, target, width, childStart);
    if (found !== null) return found;
    childStart += child.render(width).length;
  }
  return null;
}

export function findFinalAssistantTextRange(root: unknown, width: number): AssistantTextRange | null {
  if (!isRenderable(root)) return null;

  const candidates = collectAssistantComponents(root);
  const component = candidates.at(-1);
  if (!component || findLastAssistantComponent(root) !== component) return null;

  const textChildren = textChildrenForAssistant(component);
  const firstText = textChildren[0];
  const lastText = textChildren.at(-1);
  if (!firstText || !lastText) return null;

  const startLine = findRenderStart(root, firstText, width);
  const lastStart = findRenderStart(root, lastText, width);
  if (startLine === null || lastStart === null) return null;

  const endLine = lastStart + lastText.render(width).length;
  return {
    startLine,
    endLine,
    lineCount: Math.max(0, endLine - startLine),
    component,
    message: (component as any).lastMessage,
  };
}
