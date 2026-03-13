/**
 * Cybertron WebSocket dialog stream client.
 *
 * Mirrors the Java WebSocketService.callDialogStreamJson flow from the reference
 * project (websocket): connect to a configurable wss URL, send a single JSON
 * request (question, username, cybertron-robot-key, cybertron-robot-token),
 * consume JSON messages until flow_stage === "flow_exit" or timeout, then close.
 *
 * @see Reference: E:/work/code/websocket (WebSocketService.callDialogStreamJson,
 *      HttpConfig baseUrl + apis.flowStream → ws URL, requestData sent as first message)
 */

import WebSocket from "ws";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agent/cybertron-ws");

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes, same as Java

export interface CybertronWsDialogOptions {
  /** WebSocket URL (e.g. wss://host/openapi/v1/ws/dialog/) */
  wsUrl: string;
  /** First message body (must include question, username, cybertron-robot-key, cybertron-robot-token per cybertron API) */
  requestData: Record<string, unknown>;
  /** Optional headers for the WebSocket handshake */
  headers?: Record<string, string>;
  /** Connect timeout in ms. Default 30000. */
  connectTimeoutMs?: number;
  /** Stream timeout in ms (no flow_exit received). Default 20 min. */
  streamTimeoutMs?: number;
  /** Called for each parsed JSON chunk from the server */
  onChunk?: (json: Record<string, unknown>) => void;
}

/**
 * Converts an HTTP URL to a WebSocket URL (http→ws, https→wss).
 * If the URL is already ws/wss, returns it unchanged.
 */
export function httpUrlToWsUrl(httpUrl: string): string {
  const trimmed = httpUrl.trim();
  if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://")) {
    return trimmed;
  }
  if (trimmed.startsWith("https://")) {
    return trimmed.replace(/^https:\/\//, "wss://");
  }
  if (trimmed.startsWith("http://")) {
    return trimmed.replace(/^http:\/\//, "ws://");
  }
  throw new Error(`cybertron-ws: invalid URL (expected http/https/ws/wss): ${httpUrl}`);
}

/** Config shape for cybertron (subset of openclaw config). 与 E:\\work\\code\\websocket application.yml 中 websocket.client.systems.cybertron 对应. */
export interface CybertronConfigLike {
  wsUrl?: string;
  baseUrl?: string;
  apiPath?: string;
  robotKey?: string;
  robotToken?: string;
  username?: string;
  /** Optional header cybertron-app-id (e.g. agent_cyber). */
  appId?: string;
  connectTimeoutSec?: number;
  streamTimeoutMin?: number;
}

/**
 * Builds CybertronWsDialogOptions from a cybertron config block and question.
 * Returns null if config is missing or URL cannot be determined.
 */
export function buildDialogOptionsFromConfig(
  config: CybertronConfigLike | null | undefined,
  question: string,
): CybertronWsDialogOptions | null {
  if (!config) return null;
  const wsUrl = config.wsUrl
    ? config.wsUrl.trim()
    : config.baseUrl
      ? (() => {
          const base = httpUrlToWsUrl(config.baseUrl.trim()).replace(/\/+$/, "");
          const path = "/" + (config.apiPath?.trim() || "openapi/v1/ws/dialog/").replace(/^\/+/, "");
          return base + path;
        })()
      : "";
  if (!wsUrl || !question) return null;
  const requestData: Record<string, unknown> = { question };
  if (config.username != null) requestData["username"] = config.username;
  if (config.robotKey != null) requestData["cybertron-robot-key"] = config.robotKey;
  if (config.robotToken != null) requestData["cybertron-robot-token"] = config.robotToken;
  const connectTimeoutMs = config.connectTimeoutSec != null ? config.connectTimeoutSec * 1000 : undefined;
  const streamTimeoutMs =
    config.streamTimeoutMin != null ? config.streamTimeoutMin * 60 * 1000 : undefined;
  const headers: Record<string, string> = {};
  if (config.appId != null) headers["cybertron-app-id"] = config.appId;
  return {
    wsUrl,
    requestData,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    connectTimeoutMs,
    streamTimeoutMs,
  };
}

/**
 * Calls the Cybertron dialog stream over WebSocket: connect, send requestData,
 * collect messages until flow_stage === "flow_exit" or stream timeout, then close.
 * Returns the full response as concatenated JSON lines (same shape as Java).
 */
export function callDialogStreamJson(options: CybertronWsDialogOptions): Promise<string> {
  const {
    wsUrl,
    requestData,
    headers = {},
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
    onChunk,
  } = options;

  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    let streamTimer: ReturnType<typeof setTimeout> | null = null;
    let completed = false;

    const finish = (value: string) => {
      if (completed) return;
      completed = true;
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = null;
      try {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "done");
        }
      } catch {
        // ignore close errors
      }
      resolve(value);
    };

    const fail = (err: Error) => {
      if (completed) return;
      completed = true;
      if (streamTimer) clearTimeout(streamTimer);
      try {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "error");
        }
      } catch {
        // ignore
      }
      reject(err);
    };

    log.info?.("cybertron-ws connecting", { wsUrl: wsUrl.replace(/\/[^/]*$/, "/…") });

    const ws = new WebSocket(wsUrl, { headers });

    const connectTimeout = setTimeout(() => {
      if (completed) return;
      if (ws.readyState !== WebSocket.OPEN) {
        log.warn?.("cybertron-ws connect timeout", { connectTimeoutMs });
        fail(new Error(`cybertron-ws: connect timeout after ${connectTimeoutMs}ms`));
      }
    }, connectTimeoutMs);

    ws.on("open", () => {
      clearTimeout(connectTimeout);
      log.info?.("cybertron-ws connected, sending request");
      const payload = JSON.stringify(requestData);
      ws.send(payload);

      streamTimer = setTimeout(() => {
        if (!completed) {
          log.warn?.("cybertron-ws stream timeout", { streamTimeoutMs });
          finish(chunks.join("\n"));
        }
      }, streamTimeoutMs);
    });

    let firstChunk = true;
    ws.on("message", (data: WebSocket.RawData) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      if (firstChunk) {
        firstChunk = false;
        log.info?.("cybertron-ws first chunk received");
      }
      try {
        const json = JSON.parse(raw) as Record<string, unknown>;
        if (onChunk) onChunk(json);
        if (chunks.length > 0) chunks.push("");
        chunks.push(raw);

        const flowStage = json["flow_stage"];
        if (flowStage === "flow_exit") {
          log.info?.("cybertron-ws flow_exit received");
          finish(chunks.join("\n"));
        }
      } catch {
        if (chunks.length > 0) chunks.push("");
        chunks.push(raw);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(connectTimeout);
      fail(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on("close", (code, reason) => {
      clearTimeout(connectTimeout);
      if (!completed) {
        finish(chunks.join("\n"));
      }
    });
  });
}
