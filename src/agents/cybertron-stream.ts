/**
 * Cybertron WebSocket as StreamFn for the pi-embedded-runner.
 * When provider is "cybertron", the agent uses this to send the last user message
 * as question to Cybertron WebSocket and stream the reply as a single assistant message.
 */

import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildDialogOptionsFromConfig,
  callDialogStreamJson,
  type CybertronConfigLike,
} from "./cybertron-ws-client.js";
import { buildAssistantMessageWithZeroUsage, buildStreamErrorAssistantMessage } from "./stream-message-shared.js";

const log = createSubsystemLogger("agent/cybertron");

/** Default stream wait: 90s. Cap at 3 min so long-running backend still returns. */
const DEFAULT_STREAM_TIMEOUT_MS = 90 * 1000;
const MAX_STREAM_TIMEOUT_MS = 3 * 60 * 1000;

/** Extract the last user message text from Pi context.messages. */
function getLastUserMessageText(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown } | undefined;
    if (msg?.role !== "user") continue;
    const c = msg.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      const parts = c
        .filter((p): p is { type?: string; text?: string } => typeof p === "object" && p != null)
        .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
        .join("");
      if (parts) return parts.trim();
    }
  }
  return "";
}

export interface CreateCybertronStreamFnParams {
  cybertronConfig: CybertronConfigLike | null | undefined;
  sessionId: string;
  signal?: AbortSignal;
}

/**
 * Returns a StreamFn that calls the Cybertron WebSocket with the last user message
 * as question and pushes a single done event with the full reply.
 */
export function createCybertronStreamFn(params: CreateCybertronStreamFnParams): StreamFn {
  const { cybertronConfig, sessionId, signal } = params;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const modelDescriptor = { api: model.api, provider: model.provider, id: model.id };

    const run = async () => {
      try {
        const question = getLastUserMessageText(context.messages as unknown[]);
        if (!question) {
          stream.push({
            type: "done",
            reason: "stop",
            message: buildAssistantMessageWithZeroUsage({
              model: modelDescriptor,
              content: [],
              stopReason: "stop",
            }),
          });
          stream.end();
          return;
        }

        const opts = buildDialogOptionsFromConfig(cybertronConfig ?? null, question);
        if (!opts) {
          throw new Error("cybertron: config missing or invalid (need wsUrl or baseUrl)");
        }

        if (signal?.aborted) {
          throw new Error("cybertron: aborted");
        }

        const streamTimeoutMs = Math.min(
          opts.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS,
          MAX_STREAM_TIMEOUT_MS,
        );
        log.info?.("cybertron stream start", {
          questionLen: question.length,
          streamTimeoutMs,
        });

        stream.push({
          type: "start",
          partial: buildAssistantMessageWithZeroUsage({
            model: modelDescriptor,
            content: [],
            stopReason: "stop",
          }),
        });

        let fullText = "";
        const pushTextDelta = (delta: string) => {
          if (!delta) return;
          fullText += delta;
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta,
            partial: buildAssistantMessageWithZeroUsage({
              model: modelDescriptor,
              content: [{ type: "text", text: fullText }],
              stopReason: "stop",
            }),
          });
        };

        await callDialogStreamJson({
          ...opts,
          streamTimeoutMs,
          onChunk(j) {
            const type = j["type"];
            const data = j["data"];
            if (type === "string" && typeof data === "string") {
              pushTextDelta(data);
            } else if (type === "llm_end" && typeof data === "string") {
              const delta = data.slice(fullText.length);
              fullText = data;
              if (delta) {
                stream.push({
                  type: "text_delta",
                  contentIndex: 0,
                  delta,
                  partial: buildAssistantMessageWithZeroUsage({
                    model: modelDescriptor,
                    content: [{ type: "text", text: fullText }],
                    stopReason: "stop",
                  }),
                });
              }
            }
          },
        });

        log.info?.("cybertron stream done", { replyLen: fullText.trim().length });

        const content: AssistantMessage["content"] = fullText.trim()
          ? [{ type: "text", text: fullText.trim() }]
          : [];

        stream.push({
          type: "done",
          reason: "stop",
          message: buildAssistantMessageWithZeroUsage({
            model: modelDescriptor,
            content,
            stopReason: "stop",
          }),
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn?.("cybertron stream error", { error: errorMessage });
        stream.push({
          type: "error",
          reason: "error",
          error: buildStreamErrorAssistantMessage({
            model: modelDescriptor,
            errorMessage,
          }),
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}
