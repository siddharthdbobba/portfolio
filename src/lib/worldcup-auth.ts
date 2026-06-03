// src/lib/worldcup-auth.ts
// HMAC-signed session token using Web Crypto (available in Workers + Node 20+).
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64url(new Uint8Array(sig));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** token = `${issuedAtMs}.${hmac(secret, issuedAtMs)}`. */
export async function signToken(secret: string, issuedAtMs: number): Promise<string> {
  const payload = String(issuedAtMs);
  return `${payload}.${await hmac(secret, payload)}`;
}

/** Verify signature + freshness. Fails closed on any missing/invalid input. */
export async function verifyToken(
  token: string | undefined, secret: string, maxAgeMs: number, nowMs: number,
): Promise<boolean> {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, payload);
  if (!safeEqual(sig, expected)) return false;
  const issued = Number(payload);
  if (!Number.isFinite(issued)) return false;
  if (nowMs - issued > maxAgeMs) return false;       // expired
  if (issued - nowMs > 60_000) return false;          // future-dated => reject
  return true;
}
