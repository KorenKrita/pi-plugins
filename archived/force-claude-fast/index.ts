import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Force AWS Bedrock Priority Tier for every Claude model. The local provider
// is named "local-claude", so model-id matching is more reliable than checking
// for provider === "anthropic".
const PRIORITY_SERVICE_TIER = "priority";
const BEDROCK_SERVICE_TIER_HEADER = "X-Amzn-Bedrock-Service-Tier";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaude(model: { id: string } | undefined): boolean {
  return !!model && model.id.toLowerCase().includes("claude");
}

function forcePriorityHeader(headers: Record<string, unknown>): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === BEDROCK_SERVICE_TIER_HEADER.toLowerCase()) {
      delete headers[key];
    }
  }
  headers[BEDROCK_SERVICE_TIER_HEADER] = PRIORITY_SERVICE_TIER;
}

export default function forceClaudeAwsPriority(pi: ExtensionAPI) {
  // Bedrock-compatible gateways accept request-level service tier selection in
  // the payload. Remove Anthropic's unrelated native Fast Mode field if present.
  pi.on("before_provider_request", (event, ctx) => {
    if (!isClaude(ctx.model)) return;
    if (!isObject(event.payload)) return;

    const { speed: _anthropicFastMode, ...payload } = event.payload;
    return { ...payload, service_tier: PRIORITY_SERVICE_TIER };
  });

  // Claude Code's Bedrock transport uses this AWS request header. Injecting both
  // representations keeps direct Bedrock-compatible and gateway paths aligned.
  pi.on("before_provider_headers", (event, ctx) => {
    if (!isClaude(ctx.model)) return;
    if (!isObject(event.headers)) return;
    forcePriorityHeader(event.headers);
  });
}
