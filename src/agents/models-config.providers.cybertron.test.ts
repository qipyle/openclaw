import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveImplicitProvidersForTest } from "./models-config.e2e-harness.js";

describe("Cybertron implicit provider", () => {
  it("includes cybertron when config.cybertron has wsUrl", async () => {
    const config: OpenClawConfig = {
      cybertron: {
        wsUrl: "wss://example.com/openapi/v1/ws/dialog/",
        username: "test",
      },
    };
    const providers = await resolveImplicitProvidersForTest({ agentDir: "/tmp", config });
    expect(providers?.cybertron).toBeDefined();
    expect(providers?.cybertron?.api).toBe("cybertron");
    expect(providers?.cybertron?.models).toHaveLength(1);
    expect(providers?.cybertron?.models?.[0]?.id).toBe("default");
  });

  it("includes cybertron when config.cybertron has baseUrl only", async () => {
    const config: OpenClawConfig = {
      cybertron: { baseUrl: "https://example.com" },
    };
    const providers = await resolveImplicitProvidersForTest({ agentDir: "/tmp", config });
    expect(providers?.cybertron).toBeDefined();
    expect(providers?.cybertron?.api).toBe("cybertron");
  });

  it("does not include cybertron when config.cybertron is missing", async () => {
    const providers = await resolveImplicitProvidersForTest({ agentDir: "/tmp" });
    expect(providers?.cybertron).toBeUndefined();
  });

  it("does not include cybertron when config.cybertron has no url", async () => {
    const config: OpenClawConfig = {
      cybertron: { username: "u", robotKey: "k" },
    };
    const providers = await resolveImplicitProvidersForTest({ agentDir: "/tmp", config });
    expect(providers?.cybertron).toBeUndefined();
  });
});
