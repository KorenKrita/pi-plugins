import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PRIORITY_SERVICE_TIER = "priority";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function forceGptPriority(pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    if (!ctx.model?.id.toLowerCase().includes("gpt")) return;
    if (!isObject(event.payload)) return;

    return {
      ...event.payload,
      service_tier: PRIORITY_SERVICE_TIER,
    };
  });
}