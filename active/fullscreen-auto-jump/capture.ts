// Capture the live TUI through Pi's documented widget factory callback without
// leaving a visible widget behind.

export interface WidgetHost {
  setWidget(key: string, factory: unknown): void;
}

export function captureTui(ui: WidgetHost, key: string, onCapture: (tui: unknown) => void): void {
  ui.setWidget(key, (tui: unknown) => {
    onCapture(tui);
    return { render: () => [] as string[], invalidate: () => {} };
  });
  ui.setWidget(key, undefined);
}
