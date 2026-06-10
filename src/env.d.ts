// src/env.d.ts
/// <reference types="astro/client" />

// Astro v6 + @astrojs/cloudflare: secrets are read via `import { env } from
// "cloudflare:workers"`, typed against the global Cloudflare.Env interface
// (Astro.locals.runtime.env was removed in v6). Declare our secrets here so
// `env.WORLDCUP_*` is typed.
declare namespace Cloudflare {
  interface Env {
    WORLDCUP_PASSWORD?: string;
    WORLDCUP_COOKIE_SECRET?: string;
    WORLDCUP_KV?: KVNamespace;
  }
}
