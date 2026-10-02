import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Reads the live `platform.xiaomimimo.com` session cookie from a Chromium
 * browser cookie store. The platform rotates session cookies frequently, so
 * the cookie has to be read fresh at every usage refresh instead of being
 * stored once. macOS only; callers fall back to a stored cookie elsewhere.
 */

interface ChromiumBrowser {
  id: string;
  baseDir: string;
  keychainService: string;
  keychainAccount: string;
}

const MACOS_BROWSERS: ChromiumBrowser[] = [
  {
    id: "vivaldi",
    baseDir: "Library/Application Support/Vivaldi",
    keychainService: "Vivaldi Safe Storage",
    keychainAccount: "Vivaldi",
  },
  {
    id: "chrome",
    baseDir: "Library/Application Support/Google/Chrome",
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
  },
  {
    id: "brave",
    baseDir: "Library/Application Support/BraveSoftware/Brave-Browser",
    keychainService: "Brave Safe Storage",
    keychainAccount: "Brave",
  },
  {
    id: "arc",
    baseDir: "Library/Application Support/Arc/User Data",
    keychainService: "Arc Safe Storage",
    keychainAccount: "Arc",
  },
];

const COOKIE_HOST_FRAGMENT = "xiaomimimo";
const SESSION_COOKIE_NAME = "api-platform_serviceToken";
const KEY_SALT = "saltysalt";
const KEY_ITERATIONS = 1003;
const HASH_PREFIX_BYTES = 32;

interface StoredCookie {
  name: string;
  encryptedValue: Uint8Array;
  lastAccess: number;
}

export interface CookiePair {
  name: string;
  value: string;
}

const keyCache = new Map<string, Buffer | undefined>();

export function readTokenPlanBrowserCookie(): string | undefined {
  if (process.platform !== "darwin") return undefined;

  let best: { header: string; lastAccess: number } | undefined;
  for (const browser of MACOS_BROWSERS) {
    for (const profilePath of listProfilePaths(browser)) {
      const cookies = readStoredCookies(profilePath);
      if (!cookies.some((cookie) => cookie.name === SESSION_COOKIE_NAME)) continue;
      const key = loadBrowserKey(browser);
      if (!key) continue;

      const pairs = cookies.flatMap((cookie): CookiePair[] => {
        const value = decryptV10CookieValue(cookie.encryptedValue, key);
        return value === null ? [] : [{ name: cookie.name, value }];
      });
      if (!pairs.some((pair) => pair.name === SESSION_COOKIE_NAME)) continue;

      const lastAccess = Math.max(...cookies.map((cookie) => cookie.lastAccess));
      if (!best || lastAccess > best.lastAccess) best = { header: buildCookieHeader(pairs), lastAccess };
    }
  }
  return best?.header;
}

export function buildCookieHeader(pairs: CookiePair[]): string {
  return pairs.map((pair) => `${pair.name}=${pair.value}`).join("; ");
}

/**
 * Decrypt a Chromium `v10` cookie value with the browser's safe-storage key.
 * Modern Chromium stores a 32-byte hash before the actual value.
 */
export function decryptV10CookieValue(encrypted: Uint8Array, key: Buffer): string | null {
  const buffer = Buffer.from(encrypted);
  if (buffer.subarray(0, 3).toString("utf8") !== "v10" || buffer.length <= 3) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    decipher.setAutoPadding(false);
    const unpadded = removePkcs7Padding(Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]));
    const stripped = unpadded.length >= HASH_PREFIX_BYTES ? unpadded.subarray(HASH_PREFIX_BYTES) : unpadded;
    return decodePrintable(stripped) ?? decodePrintable(unpadded);
  } catch {
    return null;
  }
}

function listProfilePaths(browser: ChromiumBrowser): string[] {
  const base = join(homedir(), browser.baseDir);
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base)
      .map((entry) => join(base, entry))
      .filter((profilePath) => existsSync(join(profilePath, "Cookies")));
  } catch {
    return [];
  }
}

function readStoredCookies(profilePath: string): StoredCookie[] {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-usage-cookies-"));
  try {
    const dbPath = join(profilePath, "Cookies");
    const tmpDb = join(tmpDir, "Cookies.db");
    copyFileSync(dbPath, tmpDb);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, tmpDb + suffix);
    }
    const db = new DatabaseSync(tmpDb, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT name, encrypted_value, CAST(last_access_utc AS TEXT) AS last_access FROM cookies WHERE host_key LIKE ?",
        )
        .all(`%${COOKIE_HOST_FRAGMENT}%`) as Array<{ name: string; encrypted_value: Uint8Array; last_access: string }>;
      return rows.map((row) => ({
        name: row.name,
        encryptedValue: Buffer.from(row.encrypted_value),
        lastAccess: Number(row.last_access),
      }));
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(
      `[pi-usage] cannot read the cookie store at ${profilePath}:`,
      error instanceof Error ? error.message : error,
    );
    return [];
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function loadBrowserKey(browser: ChromiumBrowser): Buffer | undefined {
  const cached = keyCache.get(browser.id);
  if (cached) return cached;
  let key: Buffer | undefined;
  try {
    const password = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", browser.keychainService, "-a", browser.keychainAccount],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (password) key = pbkdf2Sync(password, KEY_SALT, KEY_ITERATIONS, 16, "sha1");
  } catch (error) {
    console.error(
      `[pi-usage] cannot read the ${browser.id} safe-storage key:`,
      error instanceof Error ? error.message : error,
    );
  }
  // Cache only successful reads so a transient keychain failure heals at the
  // next refresh instead of pinning the fallback for the process lifetime.
  if (key) keyCache.set(browser.id, key);
  return key;
}

function decodePrintable(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let start = 0;
    while (start < text.length && text.charCodeAt(start) < 0x20) start++;
    const value = text.slice(start);
    return value.length > 0 && /^[\x20-\x7e]+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function removePkcs7Padding(buffer: Buffer): Buffer {
  if (!buffer.length) return buffer;
  const padding = buffer[buffer.length - 1];
  return !padding || padding > 16 ? buffer : buffer.subarray(0, buffer.length - padding);
}
