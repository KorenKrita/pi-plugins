import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.FORCE_COLOR = "3";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_NODE_MODULES = process.env.PI_GLOBAL_NODE_MODULES ?? "/home/krita/.bun/install/global/node_modules";
const PI_ROOT = join(GLOBAL_NODE_MODULES, "@earendil-works/pi-coding-agent");
const TUI_ROOT = join(GLOBAL_NODE_MODULES, "@earendil-works/pi-tui");
const PI_DIST = join(PI_ROOT, "dist");
const THEME_PATH = "/home/krita/.pi/agent/themes/glass.json";
const ARTIFACTS = join(ROOT, "visual", "artifacts");
const WIDTHS = [80, 120, 160] as const;

type Handler = (event: any, context?: any) => unknown;

interface Fixture {
  name: string;
  description: string;
  component: any;
}

function packageVersion(path: string): string {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BASIC_COLORS: Record<number, string> = {
  30: "#000000",
  31: "#f7768e",
  32: "#9ece6a",
  33: "#e0af68",
  34: "#7aa2f7",
  35: "#bb9af7",
  36: "#7dcfff",
  37: "#c0caf5",
  90: "#565f89",
  91: "#f7768e",
  92: "#9ece6a",
  93: "#e0af68",
  94: "#7aa2f7",
  95: "#bb9af7",
  96: "#7dcfff",
  97: "#ffffff",
};

function ansiToHtml(input: string): string {
  const text = input.replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "");
  const ansi = /\x1b\[([0-9;]*)m/g;
  const state: { color?: string; background?: string; bold?: boolean; dim?: boolean; italic?: boolean } = {};
  let output = "";
  let last = 0;
  let match: RegExpExecArray | null;

  const append = (value: string) => {
    if (!value) return;
    const styles = [
      state.color && `color:${state.color}`,
      state.background && `background:${state.background}`,
      state.bold && "font-weight:700",
      state.dim && "opacity:.58",
      state.italic && "font-style:italic",
    ].filter(Boolean).join(";");
    const escaped = escapeHtml(value);
    output += styles ? `<span style="${styles}">${escaped}</span>` : escaped;
  };

  while ((match = ansi.exec(text)) !== null) {
    append(text.slice(last, match.index));
    last = ansi.lastIndex;
    const codes = match[1] ? match[1].split(";").map(Number) : [0];
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      if (code === 0) {
        delete state.color;
        delete state.background;
        delete state.bold;
        delete state.dim;
        delete state.italic;
      } else if (code === 1) state.bold = true;
      else if (code === 2) state.dim = true;
      else if (code === 3) state.italic = true;
      else if (code === 22) { delete state.bold; delete state.dim; }
      else if (code === 23) delete state.italic;
      else if (code === 39) delete state.color;
      else if (code === 49) delete state.background;
      else if (BASIC_COLORS[code]) state.color = BASIC_COLORS[code];
      else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
        const color = `rgb(${codes[index + 2]},${codes[index + 3]},${codes[index + 4]})`;
        if (code === 38) state.color = color;
        else state.background = color;
        index += 4;
      }
    }
  }

  append(text.slice(last));
  return output;
}

function serializePlain(lines: string[]): string {
  return lines
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, ""))
    .join("\n");
}

async function main(): Promise<void> {
  const piVersion = packageVersion(join(PI_ROOT, "package.json"));
  const tuiVersion = packageVersion(join(TUI_ROOT, "package.json"));
  if (piVersion !== "0.80.6" || tuiVersion !== "0.80.6") {
    throw new Error(`visual harness expects Pi/TUI 0.80.6, got ${piVersion}/${tuiVersion}`);
  }

  process.argv[1] = join(PI_DIST, "cli.js");

  const tui = await import(pathToFileURL(join(TUI_ROOT, "dist", "index.js")).href);
  tui.setCapabilities({ images: null, trueColor: true, hyperlinks: false });

  const themeModule = await import(pathToFileURL(join(PI_DIST, "modes/interactive/theme/theme.js")).href);
  const glass = themeModule.loadThemeFromPath(THEME_PATH, "truecolor");
  themeModule.setThemeInstance(glass);

  const handlers = new Map<string, Handler[]>();
  const notifications: string[] = [];
  const fakePi = {
    on(event: string, handler: Handler) {
      const current = handlers.get(event) ?? [];
      current.push(handler);
      handlers.set(event, current);
    },
    registerCommand() {},
  };

  const extension = await import(pathToFileURL(join(ROOT, "index.ts")).href);
  await extension.default(fakePi);

  for (const handler of handlers.get("session_start") ?? []) {
    handler({}, { ui: { notify(message: string) { notifications.push(message); } } });
  }
  if (notifications.length > 0) throw new Error(notifications.join("\n"));

  const { ToolExecutionComponent } = await import(
    pathToFileURL(join(PI_DIST, "modes/interactive/components/tool-execution.js")).href
  );

  const ui = { requestRender() {} };
  const callHandlers = handlers.get("tool_execution_start") ?? [];
  const resultHandlers = handlers.get("tool_result") ?? [];
  const originalNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;

  const start = (id: string, toolName: string, args: unknown) => {
    for (const handler of callHandlers) handler({ toolCallId: id, toolName, args }, {});
  };
  const finish = (id: string, toolName: string, content: unknown[], details: unknown, isError: boolean, elapsedMs: number) => {
    fakeNow += elapsedMs;
    for (const handler of resultHandlers) {
      handler({ toolCallId: id, toolName, input: {}, content, details, isError }, {});
    }
  };
  const create = (name: string, id: string, args: unknown, definition?: unknown) =>
    new ToolExecutionComponent(name, id, args, { showImages: false }, definition, ui, "/home/krita/Code");

  try {
    const fixtures: Fixture[] = [];

    const readArgs = { path: "/home/krita/.pi/agent/extensions/universal-tidy/README.md", limit: 12 };
    start("read", "read", readArgs);
    const read = create("read", "read", readArgs);
    read.markExecutionStarted();
    read.setArgsComplete();
    const readContent = [{ type: "text", text: "RT5│# Universal Tidy Tools (experimental)\nAsx│\nYrq│A local Pi extension that restyles every tool row.\nhmj│\ndwB│## What it changes\n\n[Showing lines 1-12 of 31. Use offset=13 to continue.]" }];
    finish("read", "read", readContent, {}, false, 11);
    read.updateResult({ content: readContent, details: {}, isError: false }, false);
    fixtures.push({ name: "read-success", description: "hashline output and home path", component: read });

    const bashArgs = { command: "printf 'universal tidy smoke test\\n'; printf 'files: '; find /home/krita/.pi/agent/extensions/universal-tidy -maxdepth 1 -type f | wc -l" };
    start("bash", "bash", bashArgs);
    const bash = create("bash", "bash", bashArgs);
    bash.markExecutionStarted();
    bash.setArgsComplete();
    const bashContent = [{ type: "text", text: "universal tidy smoke test\nfiles: 5" }];
    finish("bash", "bash", bashContent, { exitCode: 0 }, false, 21);
    bash.updateResult({ content: bashContent, details: { exitCode: 0 }, isError: false }, false);
    fixtures.push({ name: "bash-success", description: "long command and short stdout", component: bash });

    const grepArgs = { pattern: "renderResult", path: "/home/krita/.pi/agent/extensions/universal-tidy" };
    start("grep", "grep", grepArgs);
    const grep = create("grep", "grep", grepArgs);
    grep.markExecutionStarted();
    grep.setArgsComplete();
    const grepContent = [{ type: "text", text: "Path constraint must be relative to the workspace: /home/krita/.pi/agent/extensions/universal-tidy" }];
    finish("grep", "grep", grepContent, {}, true, 2);
    grep.updateResult({ content: grepContent, details: {}, isError: true }, false);
    fixtures.push({ name: "grep-error", description: "long error message", component: grep });

    const webArgs = { query: "Pi coding agent extension custom tool renderer renderCall renderResult", numResults: 3 };
    start("web", "web_search", webArgs);
    const web = create("web_search", "web", webArgs);
    web.markExecutionStarted();
    web.setArgsComplete();
    const webContent = [{ type: "text", text: "* while providing compact custom renderCall/renderResult functions. This is useful for users who prefer more concise tool output.\nSource: built-in-tool-renderer.ts\n\nCustom rendering - Control how tool calls/results and messages appear in TUI.\nSource: Extensions · Docs" }];
    const webDetails = { queries: [webArgs.query], queryCount: 1, successfulQueries: 1, totalResults: 3 };
    finish("web", "web_search", webContent, webDetails, false, 1_400);
    web.updateResult({ content: webContent, details: webDetails, isError: false }, false);
    fixtures.push({ name: "web-search", description: "external tool with structured counts", component: web });

    const pendingArgs = { command: "bun test visual/visual.test.ts --filter universal-tidy-pending-render-with-a-very-long-command" };
    start("pending", "bash", pendingArgs);
    fakeNow += 2_400;
    const pending = create("bash", "pending", pendingArgs);
    pending.markExecutionStarted();
    pending.setArgsComplete();
    pending.updateResult({ content: [{ type: "text", text: "running" }], details: {}, isError: false }, true);
    fixtures.push({ name: "pending", description: "partial tool call", component: pending });

    const expanded = create("read", "expanded", readArgs);
    expanded.markExecutionStarted();
    expanded.setArgsComplete();
    expanded.updateResult({ content: readContent, details: {}, isError: false }, false);
    expanded.setExpanded(true);
    fixtures.push({ name: "expanded-read", description: "original expanded renderer or raw fallback", component: expanded });

    const thirdPartyDefinition = {
      name: "acme_lookup",
      label: "Acme Lookup",
      description: "Visual fixture",
      parameters: {},
      async execute() { throw new Error("visual fixture must not execute"); },
      renderCall() { return new tui.Text("ORIGINAL THIRD-PARTY CALL", 0, 0); },
      renderResult(_result: unknown, options: { expanded?: boolean }) {
        return new tui.Text(options.expanded ? "ORIGINAL THIRD-PARTY EXPANDED RESULT" : "ORIGINAL THIRD-PARTY RESULT", 0, 0);
      },
    };
    const thirdArgs = { query: "universal third-party renderer compatibility across several terminal widths" };
    start("third", "acme_lookup", thirdArgs);
    const third = create("acme_lookup", "third", thirdArgs, thirdPartyDefinition);
    third.markExecutionStarted();
    third.setArgsComplete();
    const thirdContent = [{ type: "text", text: "Found one compatible record" }];
    finish("third", "acme_lookup", thirdContent, { count: 1 }, false, 730);
    third.updateResult({ content: thirdContent, details: { count: 1 }, isError: false }, false);
    fixtures.push({ name: "third-party", description: "foreign renderer stays hidden while collapsed", component: third });

    const thirdExpanded = create("acme_lookup", "third-expanded", thirdArgs, thirdPartyDefinition);
    thirdExpanded.markExecutionStarted();
    thirdExpanded.setArgsComplete();
    thirdExpanded.updateResult({ content: thirdContent, details: { count: 1 }, isError: false }, false);
    thirdExpanded.setExpanded(true);
    fixtures.push({ name: "third-party-expanded", description: "foreign renderer delegated while expanded", component: thirdExpanded });

    mkdirSync(ARTIFACTS, { recursive: true });
    const plainSections: string[] = [];
    const htmlSections: string[] = [];

    for (const width of WIDTHS) {
      plainSections.push(`===== ${width} columns =====`);
      const cards: string[] = [];
      for (const fixture of fixtures) {
        const lines = fixture.component.render(width);
        for (const line of lines) {
          if (line && tui.visibleWidth(line) > width) {
            throw new Error(`${fixture.name}@${width} exceeds width: ${tui.visibleWidth(line)}`);
          }
        }
        const plain = serializePlain(lines);
        const bodyLines = plain.split("\n").filter((line) => line.length > 0);
        if (bodyLines.some((line) => !line.startsWith("  ┊"))) {
          throw new Error(`${fixture.name}@${width} lost the visual gutter`);
        }
        if (fixture.name === "read-success" && plain.includes("RT5│")) {
          throw new Error(`read-success@${width} leaked a Hashline anchor while collapsed`);
        }
        if (fixture.name === "third-party" && plain.includes("ORIGINAL THIRD-PARTY")) {
          throw new Error(`third-party@${width} leaked its original collapsed renderer`);
        }
        if (fixture.name === "third-party-expanded" && !plain.includes("ORIGINAL THIRD-PARTY EXPANDED RESULT")) {
          throw new Error(`third-party-expanded@${width} did not delegate its original renderer`);
        }
        if (fixture.name === "web-search" && !plain.includes("3 results")) {
          throw new Error(`web-search@${width} lost its structured result summary`);
        }
        if (fixture.name === "pending" && bodyLines.length !== 1) {
          throw new Error(`pending@${width} rendered an unexpected result line`);
        }
        plainSections.push(`\n--- ${fixture.name}: ${fixture.description} ---\n${plain}`);
        cards.push(`<article class="fixture"><header><strong>${escapeHtml(fixture.name)}</strong><span>${escapeHtml(fixture.description)}</span></header><pre>${lines.map(ansiToHtml).join("\n")}</pre></article>`);
      }
      htmlSections.push(`<section class="width"><h2>${width} columns</h2>${cards.join("\n")}</section>`);
    }

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Universal Tidy Visual Preview</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#07110c;color:#f2f2f2}
body{padding:34px;font-family:"JetBrains Mono","Cascadia Mono","SFMono-Regular",Consolas,monospace}
main{display:grid;gap:34px}.width{display:grid;gap:14px}
h1{margin:0 0 8px;font:700 24px/1.2 system-ui;color:#f2f2f2}
p.meta{margin:0 0 30px;color:#a8a8a8;font:14px/1.5 system-ui}
h2{margin:0;color:#00ffff;font-size:15px;letter-spacing:.08em;text-transform:uppercase}
article.fixture{overflow:hidden;border:1px solid #173a29;border-radius:8px;background:#08140e;box-shadow:0 10px 30px rgba(0,0,0,.22)}
article header{display:flex;gap:12px;align-items:baseline;padding:8px 12px;border-bottom:1px solid #173a29;background:#0b1c14}
article header strong{color:#66ff66;font-size:12px}article header span{color:#a8a8a8;font:12px/1.3 system-ui}
pre{margin:0;padding:9px 0 10px;overflow:hidden;color:#f2f2f2;font:15px/1.48 "JetBrains Mono","Cascadia Mono","SFMono-Regular",Consolas,monospace;white-space:pre}
</style></head><body><h1>Universal Tidy visual regression</h1>
<p class="meta">Real ToolExecutionComponent · Pi ${piVersion} · TUI ${tuiVersion} · glass theme · truecolor</p>
<main>${htmlSections.join("\n")}</main></body></html>`;

    writeFileSync(join(ARTIFACTS, "preview.txt"), `${plainSections.join("\n")}\n`, "utf8");
    writeFileSync(join(ARTIFACTS, "preview.html"), html, "utf8");
    console.log(`generated ${fixtures.length * WIDTHS.length} frames`);
    console.log(join(ARTIFACTS, "preview.txt"));
    console.log(join(ARTIFACTS, "preview.html"));
  } finally {
    Date.now = originalNow;
    for (const handler of handlers.get("session_shutdown") ?? []) handler({}, {});
  }
}

await main();