import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getTokenPlanCookie } from "../auth.ts";

async function makeAuthDir(auth: object): Promise<string> {
  const authDir = await mkdtemp(join(tmpdir(), "pi-usage-auth-"));
  await writeFile(join(authDir, "auth.json"), JSON.stringify(auth, null, 2));
  return authDir;
}

async function withAuthDir<T>(authDir: string, fn: () => Promise<T>): Promise<T> {
  const originalAuthDir = process.env.PI_AUTH_DIR;
  const originalEnvCookie = process.env.PI_USAGE_TOKEN_PLAN_COOKIE;
  process.env.PI_AUTH_DIR = authDir;
  delete process.env.PI_USAGE_TOKEN_PLAN_COOKIE;
  try {
    return await fn();
  } finally {
    if (originalAuthDir === undefined) delete process.env.PI_AUTH_DIR;
    else process.env.PI_AUTH_DIR = originalAuthDir;
    if (originalEnvCookie === undefined) delete process.env.PI_USAGE_TOKEN_PLAN_COOKIE;
    else process.env.PI_USAGE_TOKEN_PLAN_COOKIE = originalEnvCookie;
  }
}

test("prefers the manual env cookie and never reads the browser store", async () => {
  const authDir = await makeAuthDir({ "xiaomi-token-plan-ams": { cookie: "userId=7; api-platform_serviceToken=stored" } });
  try {
    await withAuthDir(authDir, async () => {
      process.env.PI_USAGE_TOKEN_PLAN_COOKIE = "userId=7; api-platform_serviceToken=env";
      const result = getTokenPlanCookie(() => {
        throw new Error("browser store must not be read when the env cookie is set");
      });
      assert.deepEqual(result, { cookie: "userId=7; api-platform_serviceToken=env", source: "env" });
    });
  } finally {
    await rm(authDir, { recursive: true, force: true });
  }
});

test("keeps the stored fallback in sync with the live browser cookie", async () => {
  const authDir = await makeAuthDir({
    zai: { key: "zai-key" },
    "xiaomi-token-plan-ams": { cookie: "userId=7; api-platform_serviceToken=old" },
  });
  try {
    await withAuthDir(authDir, async () => {
      const result = getTokenPlanCookie(() => "userId=7; api-platform_serviceToken=new");
      assert.deepEqual(result, { cookie: "userId=7; api-platform_serviceToken=new", source: "browser" });

      const stored = JSON.parse(await readFile(join(authDir, "auth.json"), "utf-8"));
      assert.equal(stored["xiaomi-token-plan-ams"].cookie, "userId=7; api-platform_serviceToken=new");
      assert.deepEqual(stored.zai, { key: "zai-key" });
    });
  } finally {
    await rm(authDir, { recursive: true, force: true });
  }
});

test("does not create a stored fallback where none exists", async () => {
  const authDir = await makeAuthDir({ zai: { key: "zai-key" } });
  try {
    await withAuthDir(authDir, async () => {
      const result = getTokenPlanCookie(() => "userId=7; api-platform_serviceToken=browser");
      assert.deepEqual(result, { cookie: "userId=7; api-platform_serviceToken=browser", source: "browser" });

      const stored = JSON.parse(await readFile(join(authDir, "auth.json"), "utf-8"));
      assert.equal(stored["xiaomi-token-plan-ams"], undefined);
      assert.deepEqual(stored.zai, { key: "zai-key" });
    });
  } finally {
    await rm(authDir, { recursive: true, force: true });
  }
});

test("falls back to the stored cookie when the browser store yields nothing", async () => {
  const authDir = await makeAuthDir({ "xiaomi-token-plan-ams": { cookie: "userId=7; api-platform_serviceToken=stored" } });
  try {
    await withAuthDir(authDir, async () => {
      const result = getTokenPlanCookie(() => undefined);
      assert.deepEqual(result, { cookie: "userId=7; api-platform_serviceToken=stored", source: "stored" });
    });
  } finally {
    await rm(authDir, { recursive: true, force: true });
  }
});

test("explains the remedy when no cookie exists at all", async () => {
  const authDir = await makeAuthDir({});
  try {
    await withAuthDir(authDir, async () => {
      assert.throws(() => getTokenPlanCookie(() => undefined), /open the MiMo platform once/);
    });
  } finally {
    await rm(authDir, { recursive: true, force: true });
  }
});
