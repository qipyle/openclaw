/**
 * E2E for 手工测试: script starts Gateway, polls until ready, then (when not NO_BROWSER) opens browser.
 * Runs manual-test.mjs with NO_BROWSER and a dedicated port, asserts gateway responds, then cleans up.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "manual-test.mjs");
const RUN_TIMEOUT_MS = 260_000;

async function getFreePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  if (!addr || typeof addr === "string") {
    srv.close();
    throw new Error("failed to bind ephemeral port");
  }
  const port = addr.port;
  await new Promise<void>((r) => srv.close(r));
  return port;
}

function killPid(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
}

describe("manual-test (手工测试) e2e", () => {
  let port: number;
  let pidFile: string;

  afterAll(() => {
    if (!pidFile || !fs.existsSync(pidFile)) {
      return;
    }
    try {
      const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
      if (Number.isFinite(pid)) {
        killPid(pid);
      }
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // ignore
    }
  });

  it(
    "starts gateway, waits until ready, then exits 0; gateway responds on BASE URL",
    { timeout: RUN_TIMEOUT_MS + 30_000 },
    async () => {
      port = await getFreePort();
      pidFile = path.join(os.tmpdir(), `openclaw-manual-test-pid-${randomUUID()}`);
      const homeDir = path.join(os.tmpdir(), `openclaw-manual-test-home-${randomUUID()}`);
      await fs.promises.mkdir(homeDir, { recursive: true });

      const env = {
        ...process.env,
        OPENCLAW_HOME: homeDir,
        OPENCLAW_MANUAL_TEST_PORT: String(port),
        OPENCLAW_MANUAL_TEST_NO_BROWSER: "1",
        OPENCLAW_MANUAL_TEST_PID_FILE: pidFile,
        OPENCLAW_MANUAL_TEST_TIMEOUT_MS: "220000",
      };

      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
        timeout: RUN_TIMEOUT_MS,
      });

      expect(result.status, result.stderr ?? result.stdout ?? "no output").toBe(0);

      const base = `http://127.0.0.1:${port}/`;
      const res = await fetch(base, { method: "GET", signal: AbortSignal.timeout(5000) });
      expect([200, 401, 403], `GET ${base} returned ${res.status}`).toContain(res.status);
    },
  );
});
