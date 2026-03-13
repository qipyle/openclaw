/**
 * Unit tests for Cybertron WebSocket client (URL conversion and config build).
 * callDialogStreamJson is integration-style; e2e can use a real or mock WS server.
 */

import { describe, expect, it } from "vitest";
import {
  buildDialogOptionsFromConfig,
  httpUrlToWsUrl,
  type CybertronConfigLike,
} from "./cybertron-ws-client.js";

describe("httpUrlToWsUrl", () => {
  it("converts https to wss", () => {
    expect(httpUrlToWsUrl("https://www.cybotstar.cn")).toBe("wss://www.cybotstar.cn");
    expect(httpUrlToWsUrl("https://host/path")).toBe("wss://host/path");
  });

  it("converts http to ws", () => {
    expect(httpUrlToWsUrl("http://localhost:8080")).toBe("ws://localhost:8080");
  });

  it("leaves ws/wss unchanged", () => {
    expect(httpUrlToWsUrl("wss://host/openapi/v1/ws/dialog/")).toBe(
      "wss://host/openapi/v1/ws/dialog/",
    );
    expect(httpUrlToWsUrl("ws://host/")).toBe("ws://host/");
  });

  it("throws for invalid URL", () => {
    expect(() => httpUrlToWsUrl("ftp://host")).toThrow(/invalid URL/);
  });
});

describe("buildDialogOptionsFromConfig", () => {
  it("returns null when config is null or undefined", () => {
    expect(buildDialogOptionsFromConfig(null, "hello")).toBeNull();
    expect(buildDialogOptionsFromConfig(undefined, "hello")).toBeNull();
  });

  it("returns null when question is empty", () => {
    expect(
      buildDialogOptionsFromConfig({ wsUrl: "wss://host/ws" }, ""),
    ).toBeNull();
  });

  it("builds options from wsUrl", () => {
    const config: CybertronConfigLike = {
      wsUrl: "wss://www.cybotstar.cn/openapi/v1/ws/dialog/",
      robotKey: "key",
      robotToken: "token",
      username: "user",
    };
    const opts = buildDialogOptionsFromConfig(config, "你是谁");
    expect(opts).not.toBeNull();
    expect(opts!.wsUrl).toBe("wss://www.cybotstar.cn/openapi/v1/ws/dialog/");
    expect(opts!.requestData).toEqual({
      question: "你是谁",
      username: "user",
      "cybertron-robot-key": "key",
      "cybertron-robot-token": "token",
    });
  });

  it("builds wsUrl from baseUrl + apiPath", () => {
    const opts = buildDialogOptionsFromConfig(
      {
        baseUrl: "https://www.cybotstar.cn",
        apiPath: "/openapi/v1/ws/dialog/",
        username: "u",
      },
      "q",
    );
    expect(opts).not.toBeNull();
    expect(opts!.wsUrl).toBe("wss://www.cybotstar.cn/openapi/v1/ws/dialog/");
    expect(opts!.requestData.question).toBe("q");
    expect(opts!.requestData.username).toBe("u");
  });

  it("uses default apiPath when not provided", () => {
    const opts = buildDialogOptionsFromConfig(
      { baseUrl: "https://host" },
      "q",
    );
    expect(opts!.wsUrl).toBe("wss://host/openapi/v1/ws/dialog/");
  });

  it("returns null when neither wsUrl nor baseUrl", () => {
    expect(buildDialogOptionsFromConfig({}, "q")).toBeNull();
  });

  it("passes through connectTimeoutSec and streamTimeoutMin", () => {
    const opts = buildDialogOptionsFromConfig(
      {
        wsUrl: "wss://h/",
        connectTimeoutSec: 10,
        streamTimeoutMin: 5,
      },
      "q",
    );
    expect(opts!.connectTimeoutMs).toBe(10_000);
    expect(opts!.streamTimeoutMs).toBe(5 * 60 * 1000);
  });

  it("sets cybertron-app-id header when appId is provided", () => {
    const opts = buildDialogOptionsFromConfig(
      { wsUrl: "wss://h/", appId: "agent_cyber" },
      "q",
    );
    expect(opts!.headers).toEqual({ "cybertron-app-id": "agent_cyber" });
  });
});
