// Password hashing, random tokens and cookie signing. node:crypto only, no framework imports,
// so scripts and tests can use it too. Security relies on runtime secrets, never on code.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Format: scrypt$N$r$p$saltB64url$hashB64url */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error("password length out of range");
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time check. A missing or malformed hash never verifies. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored || password.length > PASSWORD_MAX_LENGTH) {
    // Spend comparable time so missing accounts are not distinguishable by timing.
    await scrypt(password.slice(0, PASSWORD_MAX_LENGTH), randomBytes(16), PARAMS.keylen,
      { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Bounded, sane parameters only: N a power of two in [2^10, 2^20], small r and p.
  if (![N, r, p].every(Number.isInteger) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0
      || r < 1 || r > 16 || p < 1 || p > 4) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length < 16 || expected.length < 32 || expected.length > 128) return false;
  try {
    const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false; // fail closed on any malformed stored hash
  }
}

/** 256-bit random token, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

/** `token.signature` for the session cookie. */
export function signValue(value: string, secret: string): string {
  return `${value}.${hmac(value, secret)}`;
}

/** Returns the inner value when the signature is valid, else null. Timing-safe. */
export function unsignValue(signed: string | undefined | null, secret: string): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(hmac(value, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
