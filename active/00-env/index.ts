// Generic env injector for Pi extensions/packages.
// Loads ~/.pi/agent/env.json into process.env at extension-load time.
// Named "00-env" so directory discovery loads it before sibling extensions;
// the global extensions dir loads before all package extensions (loader.js:
// local dir -> global dir -> configured packages, sequential), so values are
// visible to packages like pi-fff and pi-memini even at import time.
// Existing process env always wins — a value set in the shell overrides this file.
// NOTE: env vars read by pi core BEFORE extensions load (PI_CACHE_RETENTION,
// PI_TELEMETRY, PI_CODING_AGENT_DIR, ...) cannot be injected here; keep those in shell rc.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

try {
  const cfg = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "env.json"), "utf8"));
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === "string" && !process.env[k]) process.env[k] = v;
  }
} catch {
  // missing/invalid env.json — nothing to inject
}

export default function () {}
