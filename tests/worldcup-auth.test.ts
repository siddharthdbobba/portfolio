// tests/worldcup-auth.test.ts
import { describe, it, expect } from "vitest";
import { signToken, verifyToken, safeEqual } from "../src/lib/worldcup-auth";

const SECRET = "test-cookie-secret";
const HOUR = 3600_000;
const MONTH = 30 * 24 * HOUR;

describe("safeEqual", () => {
  it("is true for equal strings, false otherwise", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("token sign/verify", () => {
  it("round-trips a fresh token", async () => {
    const now = 1_700_000_000_000;
    const token = await signToken(SECRET, now);
    expect(await verifyToken(token, SECRET, MONTH, now + HOUR)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const now = 1_700_000_000_000;
    const token = await signToken(SECRET, now);
    expect(await verifyToken(token, SECRET, MONTH, now + MONTH + 1)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const now = 1_700_000_000_000;
    const token = await signToken(SECRET, now);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifyToken(tampered, SECRET, MONTH, now)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const now = 1_700_000_000_000;
    const token = await signToken("other-secret", now);
    expect(await verifyToken(token, SECRET, MONTH, now)).toBe(false);
  });

  it("fails closed on missing token or secret", async () => {
    expect(await verifyToken(undefined, SECRET, MONTH, 0)).toBe(false);
    expect(await verifyToken("x.y", "", MONTH, 0)).toBe(false);
  });
});
