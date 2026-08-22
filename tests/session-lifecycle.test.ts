import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerUsage from "../index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("does not touch an ended session when its agent-end refresh settles later", async () => {
  const authDir = await mkdtemp(join(tmpdir(), "pi-usage-auth-"));
  const originalAuthDir = process.env.PI_AUTH_DIR;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const response = deferred<Response>();
  const fetchStarted = deferred<void>();
  const errors: unknown[][] = [];
  let active = true;
  let staleAccesses = 0;

  await writeFile(join(authDir, "auth.json"), JSON.stringify({
    "github-copilot": {
      type: "oauth",
      access: "test-access",
      refresh: "test-refresh",
      expires: 0,
    },
  }));

  process.env.PI_AUTH_DIR = authDir;
  globalThis.fetch = (() => {
    fetchStarted.resolve();
    return response.promise;
  }) as typeof fetch;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  try {
    const handlers = new Map<string, Handler[]>();
    const pi = {
      on(event: string, handler: Handler) {
        const registered = handlers.get(event) ?? [];
        registered.push(handler);
        handlers.set(event, registered);
      },
    };
    registerUsage(pi as never);

    const ui = {
      theme: { fg: (_color: string, text: string) => text },
      setWidget() {
        if (!active) staleAccesses++;
      },
      setStatus() {
        if (!active) staleAccesses++;
      },
      notify() {
        if (!active) staleAccesses++;
      },
    };
    const ctx = {
      model: { provider: "github-copilot" },
      modelRegistry: {
        async getApiKeyForProvider() {
          return "test-access";
        },
      },
      get ui() {
        if (!active) {
          staleAccesses++;
          throw new Error("stale session context");
        }
        return ui;
      },
    };

    await handlers.get("agent_end")?.[0]?.({}, ctx);
    await fetchStarted.promise;
    await handlers.get("session_shutdown")?.[0]?.({}, ctx);
    active = false;

    response.resolve(new Response(JSON.stringify({
      copilot_plan: "pro",
      quota_reset_date_utc: "2099-08-01",
      quota_snapshots: {
        premium_interactions: { percent_remaining: 72 },
      },
    }), { status: 200 }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(staleAccesses, 0);
    assert.deepEqual(errors, []);
  } finally {
    if (originalAuthDir === undefined) delete process.env.PI_AUTH_DIR;
    else process.env.PI_AUTH_DIR = originalAuthDir;
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    await rm(authDir, { recursive: true, force: true });
  }
});
