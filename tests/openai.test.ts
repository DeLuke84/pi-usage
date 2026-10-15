import assert from "node:assert/strict";
import test from "node:test";
import registerUsage from "../index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

for (const oauth of [true, false]) {
  test(`handles openai ${oauth ? "OAuth" : "API key"} without quota requests or notifications`, async () => {
    const handlers = new Map<string, Handler>();
    registerUsage({ on: (event: string, handler: Handler) => handlers.set(event, handler) } as never);
    const statuses: (string | undefined)[] = [];
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      throw new Error("must not request quota for openai");
    }) as typeof fetch;
    const ctx = {
      model: { provider: "openai" },
      modelRegistry: {
        isUsingOAuth(model: { provider: string }) {
          assert.equal(model.provider, "openai");
          return oauth;
        },
        async getApiKeyForProvider() { throw new Error("must not resolve credentials"); },
      },
      ui: {
        setWidget() {},
        setStatus(id: string, text: string | undefined) {
          if (id === "pi-usage") statuses.push(text);
        },
        notify() { assert.fail("quota unavailability is not an error"); },
      },
    };
    try {
      for (const event of ["session_start", "model_select", "agent_end"]) {
        await handlers.get(event)?.({}, ctx);
        assert.equal(statuses.at(-1), oauth ? "ChatGPT quota unavailable" : undefined);
      }
      assert.equal(requests, 0);
      ctx.model.provider = "unsupported";
      await handlers.get("model_select")?.({}, ctx);
      assert.equal(statuses.at(-1), undefined);
    } finally {
      await handlers.get("session_shutdown")?.({}, ctx);
      globalThis.fetch = originalFetch;
    }
  });
}

test("a late Codex response cannot overwrite the ChatGPT unavailable status", async () => {
  const handlers = new Map<string, Handler>();
  registerUsage({ on: (event: string, handler: Handler) => handlers.set(event, handler) } as never);
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-openai-"));
  const originalDir = process.env.PI_AUTH_DIR;
  const originalFetch = globalThis.fetch;
  let resolve!: (response: Response) => void;
  let started!: () => void;
  const fetchStarted = new Promise<void>((done) => { started = done; });
  const pending = new Promise<Response>((done) => { resolve = done; });
  const statuses: (string | undefined)[] = [];
  try {
    await writeFile(join(dir, "auth.json"), JSON.stringify({
      "openai-codex": { type: "oauth", access: "test", refresh: "test", expires: 0, accountId: "test" },
    }));
    process.env.PI_AUTH_DIR = dir;
    globalThis.fetch = (() => { started(); return pending; }) as typeof fetch;
    const ctx = {
      model: { provider: "openai-codex" },
      modelRegistry: { isUsingOAuth: () => true, getApiKeyForProvider: async () => "test" },
      ui: {
        theme: { fg: (_color: string, text: string) => text },
        setWidget() {},
        setStatus(id: string, text: string | undefined) { if (id === "pi-usage") statuses.push(text); },
        notify() { assert.fail("unexpected error notification"); },
      },
    };
    await handlers.get("session_start")?.({}, ctx);
    await fetchStarted;
    ctx.model = { provider: "openai" };
    await handlers.get("model_select")?.({}, ctx);
    assert.equal(statuses.at(-1), "ChatGPT quota unavailable");
    const count = statuses.length;
    resolve(new Response(JSON.stringify({ rate_limit: { primary_window: {
      used_percent: 25, reset_after_seconds: 3600,
    } } })));
    await new Promise((done) => setImmediate(done));
    assert.equal(statuses.length, count);
  } finally {
    await handlers.get("session_shutdown")?.({}, {});
    globalThis.fetch = originalFetch;
    if (originalDir === undefined) delete process.env.PI_AUTH_DIR;
    else process.env.PI_AUTH_DIR = originalDir;
    await rm(dir, { recursive: true, force: true });
  }
});
