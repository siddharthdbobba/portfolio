// src/pages/api/worldcup-login.ts
import type { APIRoute } from "astro";
import { safeEqual, signToken } from "../../lib/worldcup-auth";

export const prerender = false; // MUST be on-demand: a prerendered endpoint can't POST.

export const COOKIE_NAME = "wc_auth";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

export const POST: APIRoute = async (context) => {
  const env = context.locals.runtime?.env ?? ({} as Record<string, string>);
  const password = env.WORLDCUP_PASSWORD;
  const cookieSecret = env.WORLDCUP_COOKIE_SECRET;
  if (!password || !cookieSecret) {
    return context.redirect("/worldcup?error=config", 302); // fail closed
  }
  const form = await context.request.formData();
  const submitted = String(form.get("password") ?? "");
  if (!safeEqual(submitted, password)) {
    return context.redirect("/worldcup?error=1", 302);
  }
  const token = await signToken(cookieSecret, Date.now());
  context.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/worldcup",
    maxAge: MAX_AGE_S,
  });
  return context.redirect("/worldcup", 302);
};
