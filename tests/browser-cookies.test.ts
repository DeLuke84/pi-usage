import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";

import { buildCookieHeader, decryptV10CookieValue } from "../browser-cookies.ts";

const key = pbkdf2Sync("test-password", "saltysalt", 1003, 16, "sha1");

function encryptV10(value: string, encryptionKey: Buffer, withHashPrefix: boolean): Buffer {
  const plain = Buffer.concat([withHashPrefix ? Buffer.alloc(32, 0x07) : Buffer.alloc(0), Buffer.from(value, "utf8")]);
  const padded = padPkcs7(plain);
  const cipher = createCipheriv("aes-128-cbc", encryptionKey, Buffer.alloc(16, 0x20));
  cipher.setAutoPadding(false);
  return Buffer.concat([Buffer.from("v10"), cipher.update(padded), cipher.final()]);
}

function padPkcs7(buffer: Buffer): Buffer {
  const padding = 16 - (buffer.length % 16);
  return Buffer.concat([buffer, Buffer.alloc(padding, padding)]);
}

test("decrypts v10 cookies with the modern 32-byte hash prefix", () => {
  const encrypted = encryptV10("service-token-value-123", key, true);
  assert.equal(decryptV10CookieValue(encrypted, key), "service-token-value-123");
});

test("falls back to short hash-less values", () => {
  // Modern Chromium always stores a 32-byte hash before the value; the
  // unpadded fallback covers legacy values shorter than that prefix.
  const encrypted = encryptV10("short-value", key, false);
  assert.equal(decryptV10CookieValue(encrypted, key), "short-value");
});

test("rejects values that do not decrypt with the given key", () => {
  const wrongKey = pbkdf2Sync("other-password", "saltysalt", 1003, 16, "sha1");
  const encrypted = encryptV10("service-token-value-123", key, true);
  assert.equal(decryptV10CookieValue(encrypted, wrongKey), null);
});

test("rejects payloads without a v10 marker", () => {
  assert.equal(decryptV10CookieValue(Buffer.from("v9nonsense"), key), null);
});

test("buildCookieHeader joins name/value pairs in order", () => {
  const header = buildCookieHeader([
    { name: "userId", value: "1574642221" },
    { name: "api-platform_serviceToken", value: "token" },
  ]);
  assert.equal(header, "userId=1574642221; api-platform_serviceToken=token");
});
