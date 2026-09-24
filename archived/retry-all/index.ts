import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
} from "@earendil-works/pi-ai";

const DIAGNOSTIC_TYPE = "retry-all-original-error";
const FORCED_ERROR_MESSAGE = "network error: retry-all forced retry";

function wasAlreadyForced(message: AssistantMessage): boolean {
  return message.diagnostics?.some((diagnostic) => diagnostic.type === DIAGNOSTIC_TYPE) ?? false;
}

/**
 * Reclassify an otherwise non-retryable assistant/API error so Pi's native
 * retry loop handles it. Context overflow is left to Pi's compaction recovery.
 */
export function forceRetryMessage(
  message: AssistantMessage,
  contextWindow = 0,
): AssistantMessage | undefined {
  if (message.stopReason !== "error" || !message.errorMessage) return;
  if (wasAlreadyForced(message)) return;
  if (isContextOverflow(message, contextWindow)) return;
  if (isRetryableAssistantError(message)) return;

  const originalError = message.errorMessage;

  return {
    ...message,
    content: [
      ...message.content,
      {
        type: "text",
        text: `[retry-all original error]\n${originalError}`,
      },
    ],
    diagnostics: [
      ...(message.diagnostics ?? []),
      {
        type: DIAGNOSTIC_TYPE,
        timestamp: Date.now(),
        error: { message: originalError },
        details: { forcedRetry: true },
      },
    ],
    // Keep known non-retryable keywords out of errorMessage. Pi checks those
    // before retryable markers; the exact original remains above and in diagnostics.
    errorMessage: FORCED_ERROR_MESSAGE,
  };
}

export default function retryAll(pi: ExtensionAPI) {
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const replacement = forceRetryMessage(
      event.message,
      ctx.model?.contextWindow ?? 0,
    );
    if (!replacement) return;

    ctx.ui.notify(
      `retry-all: forcing retry for ${event.message.errorMessage}`,
      "warning",
    );
    return { message: replacement };
  });
}
