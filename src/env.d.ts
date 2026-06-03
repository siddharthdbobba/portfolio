// src/env.d.ts
/// <reference types="astro/client" />

type WorldcupEnv = {
  WORLDCUP_PASSWORD?: string;
  WORLDCUP_COOKIE_SECRET?: string;
};

declare namespace App {
  interface Locals {
    runtime: import("@astrojs/cloudflare").Runtime<WorldcupEnv>;
  }
}
