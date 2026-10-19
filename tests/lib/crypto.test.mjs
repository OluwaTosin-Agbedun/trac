// Security properties of password hashing, tokens and cookie signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, newToken, sha256Hex, signValue, unsignValue, isUuid } from "../../src/server/auth/crypto.ts";

test("passwords hash with a per-user salt and verify only the right password", async () => {
  const a = await hashPassword("correct horse battery staple");
  const b = await hashPassword("correct horse battery staple");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("correct horse battery staple", a), true);
  assert.equal(await verifyPassword("correct horse battery stapler", a), false);
  assert.equal(await verifyPassword("anything at all here", null), false);
  assert.equal(await verifyPassword("anything at all here", "scrypt$1$1$1$x$y"), false);
  await assert.rejects(hashPassword("short"));
});

test("hash parameters from storage are bounded (no DoS through a tampered hash)", async () => {
  assert.equal(await verifyPassword("whatever password", "scrypt$1048577$8$1$AAAA$AAAA"), false);
  assert.equal(await verifyPassword("whatever password", "scrypt$32768$64$1$AAAA$AAAA"), false);
});

test("tokens are 256-bit, URL-safe and unique", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = newToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
  assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
});

test("signed cookie values reject tampering and wrong secrets", () => {
  const secret = "a".repeat(40);
  const token = newToken();
  const signed = signValue(token, secret);
  assert.equal(unsignValue(signed, secret), token);
  assert.equal(unsignValue(signed, "b".repeat(40)), null);
  assert.equal(unsignValue(signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A"), secret), null);
  assert.equal(unsignValue(newToken() + signed.slice(signed.lastIndexOf(".")), secret), null);
  assert.equal(unsignValue("", secret), null);
  assert.equal(unsignValue(undefined, secret), null);
  assert.equal(unsignValue("no-dot-here", secret), null);
});

test("isUuid accepts only canonical UUIDs", () => {
  assert.equal(isUuid("00000000-0000-4000-8000-0000000000a1"), true);
  assert.equal(isUuid("00000000-0000-4000-8000-0000000000a1' or 1=1--"), false);
  assert.equal(isUuid(42), false);
});
