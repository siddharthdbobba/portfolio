# Password-locked World Cup predictor visualization — design

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review
**Repos touched:** `portfolio` (Astro/Cloudflare site — primary), `worldcup-predictor` (Python — additive export)

## Goal

Add a password-locked page to the portfolio site (siddharthbobba.com) at
`/worldcup` that **visualizes what the World Cup predictor is doing** — the full
pipeline (group draw → Elo ratings → market prices → Monte Carlo → blend → Kelly
bets) and the data flowing through it, not just the final odds. The page pulls all
its data from the predictor via a committed-at-build-time JSON snapshot.

## Key constraints (discovered during brainstorming)

1. **The `portfolio` repo is PUBLIC** (`siddharthdbobba/portfolio`). The snapshot
   contains the predictions we are gating behind a password, so it must **never** be
   committed to git or placed in `public/`. It is gitignored and bundled into the
   SSR Worker function at build time — server-side only, never a public asset.
2. **No SSR route exists in the portfolio yet.** Astro's default is static
   (prerendered at build). A prerendered page cannot gate per-request and a
   prerendered endpoint cannot handle POST, so the lock would silently do nothing.
   Both the gated page and the login endpoint MUST set `export const prerender = false`.
3. **Cloudflare secrets are read at runtime**, via `Astro.locals.runtime.env`, NOT
   `import.meta.env` (which is build-time only and `undefined` in the Worker).
4. **2026 tournament format:** first knockout round is **R32** (12 group winners +
   12 runners-up + 8 best third-placed teams = 32). Advancement labels are
   R32 → R16 → QF → SF → Final → Champion.

## Architecture & data flow

Three hops, no live hosting of the Python app:

1. **Predictor → JSON.** A new `snapshot` command in `worldcup-predictor` runs the
   real pipeline (live draw/ratings/markets + a 20k Monte Carlo) and writes one rich
   JSON file to `portfolio/src/data/worldcup-snapshot.json` (gitignored).
2. **JSON → page.** The Astro page loads that JSON at build time via
   `import.meta.glob` (a missing file degrades to a committed safe sample instead of
   breaking the build). The data compiles into the SSR Worker bundle — server-side
   only, only sent to the browser after auth.
3. **Deploy.** `npm run deploy` builds locally (bundling whatever snapshot is
   present) and uploads the Worker. Refresh = re-run `snapshot`, then redeploy.

This is the "static snapshot" approach (option A from brainstorming): zero extra
infra, fully reproducible, "as of <date>" snapshots are appropriate for a portfolio
piece.

## Security model

- **Single shared password**, stored as a Cloudflare secret `WORLDCUP_PASSWORD`.
- **Signed session cookie**: on successful login the Worker sets an HttpOnly, Secure,
  SameSite=Lax cookie containing an HMAC-signed token (keyed by a second secret
  `WORLDCUP_COOKIE_SECRET`), with a finite Max-Age (e.g. 30 days). HMAC uses **Web
  Crypto** (`crypto.subtle`) — Node `crypto` is not available in the Worker by default.
- **Fails closed**: if either secret is missing at runtime, auth denies access. The
  password and the snapshot data never reach the browser unless the cookie verifies.
- Password comparison is constant-time.

## Predictor changes (`worldcup-predictor`, Python — additive)

The existing agent path and tests must remain unchanged. All new code is additive.

### `src/worldcup/simulator.py`
- Add **`run_simulation_detailed(...)`**: like `run_simulation` but tracks each team's
  deepest round reached across all sims. Returns `(champion_probs, advancement)` where
  `advancement` is `{team: {"r32": p, "r16": p, "qf": p, "sf": p, "final": p, "champion": p}}`.
  `run_simulation` is left untouched so the agent and current tests don't change.
- Implementation: `simulate_once` already plays a 32-seed bracket; a detailed variant
  records, per sim, the furthest stage each qualifier reached (group non-qualifiers
  get no KO stage). Aggregate counts → probabilities over `n`.

### `src/worldcup/snapshot.py` (new)
- **`build_snapshot(...)`** — pure: takes already-fetched inputs (ratings, groups,
  market/ask/confidence/depth, bankroll, sim params) + the detailed-sim and pipeline
  outputs, returns the snapshot `dict`. No I/O. Unit-testable on fixtures.
- **CLI** (`python -m worldcup.snapshot`): fetches live draw/ratings/markets (reusing
  `draw.py`/`ratings.py`/`markets.py`), runs `run_simulation_detailed` + the existing
  `run_pipeline`/`blend`/`recommend_bets`, calls `build_snapshot`, writes JSON to
  `--out` (default `../portfolio/src/data/worldcup-snapshot.json`). Flags mirror
  `main.py`: `--bankroll`, `--sims`, `--seed`, `--kelly-fraction`, `--min-edge`, `--out`.
  Reuses existing fallbacks (draw → committed fixture) but **fails loudly** if markets
  are unfetchable rather than shipping stale prices.

### Tests (`tests/`, pytest, matching existing style)
- `run_simulation_detailed`: monotonicity (champion ⊆ final ⊆ sf ⊆ qf ⊆ r16 ⊆ r32),
  every team appears in group stage, probabilities in [0, 1], champion probs match
  `run_simulation` within Monte Carlo tolerance on a fixed seed.
- `build_snapshot`: shape/keys test on small fixtures; bankroll-absent omits the card.

## Snapshot JSON schema

```jsonc
{
  "meta": {
    "generated_at": "2026-06-02T...Z",   // stamped by the CLI at write time
    "n_sims": 20000, "seed": 42, "kelly_fraction": 0.5, "min_edge": 0.05,
    "model_params": { "base": 1.35, "scale": 2000.0, "host_bump": 60.0,
                      "hosts": ["United States", "Canada", "Mexico"] },
    "sources": ["Polymarket", "Kalshi", "eloratings.net"]
  },
  "draw": { "A": ["...", "...", "...", "..."], /* 12 groups × 4 */ },
  "ratings": { "Spain": 2089.4, /* Elo per drawn team */ },
  "forecasts": [ { "team": "Spain", "model_pct": 0.18, "market_pct": 0.16,
                   "blended_pct": 0.17 } /* sorted by blended desc */ ],
  "market": { "Spain": { "prob": 0.16, "ask": 0.17, "volume": 1234.0, "depth": 5000.0 } },
  "blend_weights": { "Spain": 0.41 },     // market weight w per priced team
  "advancement": { "Spain": { "r32": 0.92, "r16": 0.78, "qf": 0.55,
                              "sf": 0.34, "final": 0.22, "champion": 0.18 } },
  "bankroll": 100.0,                       // null if forecast-only run
  "bets": [ { "team": "...", "ask": 0.12, "model_pct": 0.18, "market_pct": 0.10,
              "edge": 0.08, "ev_pct": 0.5, "stake": 12.0, "potential_profit": 88.0 } ],
  "staked": 42.0, "reserve": 58.0          // present only when bankroll set
}
```

## Portfolio changes (`portfolio`, Astro SSR)

### `src/lib/worldcup-auth.ts`
Pure HMAC sign/verify of the session token using `crypto.subtle` (Web Crypto),
keyed by `WORLDCUP_COOKIE_SECRET`. `signToken(secret)`, `verifyToken(cookie, secret)`,
constant-time password compare helper. No framework deps — independently testable.

### `src/lib/worldcup-data.ts`
Loads the snapshot via `import.meta.glob('../data/worldcup-snapshot.json', { eager: true })`
— returns the real file if present, else a committed safe sample
(`src/data/worldcup-snapshot.sample.json`, empty/fake, public-safe). Exports a TS
type for the snapshot shape so components are typed.

### `src/pages/api/worldcup-login.ts` (`export const prerender = false`)
POST handler. Reads form password, constant-time compares against
`locals.runtime.env.WORLDCUP_PASSWORD`. On match: set signed HttpOnly/Secure/
SameSite=Lax cookie, 302 → `/worldcup`. On miss: 302 → `/worldcup?error=1`. Fails
closed if the secret is unset. (Optional `logout` clears the cookie.)

### `src/pages/worldcup.astro` (`export const prerender = false`)
Reads + verifies the cookie. If invalid → render the login form (posts to the API
route, shows an error on `?error=1`). If valid → render the dashboard from the
loaded snapshot. If snapshot is the empty sample → "snapshot unavailable" state.

### Visualization components (`src/components/worldcup/*.astro`)
Hand-rolled inline SVG/CSS — **no chart library** (matches the site's dependency-light
vanilla style, keeps the Worker bundle lean, works without JS). Reuses existing design
tokens (`.card`, `.mono`, `.muted`, `.section`, `.container`, `.reveal`).

1. **PipelineStrip** — Draw → Elo → Market → Monte Carlo → Blend → Kelly, headline
   number at each stage (e.g. "48 teams", "20k sims", "N value bets").
2. **EdgeChart** *(centerpiece)* — sorted per-team bars, Model vs Market vs Blended
   side by side, visually flagging where the model disagrees with the market.
3. **AdvancementFunnel** — the Monte Carlo "look inside": per-team R32 → Champion
   stage probabilities (e.g. nested bars / funnel per top team).
4. **GroupGrid** — the 12 groups (4 teams each), tinted by championship probability.
5. **BettingCard** — Kelly bets (ask, edge, EV, stake, profit) + bankroll/staked/
   reserve, with the educational disclaimer. Rendered only when `bankroll` is set.
6. **RunMeta** — as-of date, n_sims, seed, sources.

### Config / files
- `astro.config.mjs`: keep Cloudflare adapter; rely on per-route `prerender = false`
  (no global `output` change needed, but verify the two routes emit as server
  functions after build).
- `.gitignore`: add `src/data/worldcup-snapshot.json`.
- Commit `src/data/worldcup-snapshot.sample.json` (safe placeholder).
- Secrets: `wrangler secret put WORLDCUP_PASSWORD`, `wrangler secret put
  WORLDCUP_COOKIE_SECRET`; local `.dev.vars` for `wrangler dev`.

## Error handling / edge cases

- **Missing/empty snapshot** → page renders a graceful "snapshot unavailable" state
  (still behind auth).
- **Missing secrets at runtime** → auth fails closed (deny).
- **Markets unfetchable during export** → CLI errors out (no stale data shipped).
- **Forecast-only snapshot** (no bankroll) → BettingCard omitted; everything else renders.

## Verification (evidence before "done")

- Predictor: `.venv/bin/pytest -q` passes, including new tests.
- Portfolio: `astro build` succeeds **and** the two routes are emitted as server
  functions (not static HTML). Then exercise the real login flow under `wrangler dev`
  with `.dev.vars` secrets: wrong password is rejected, correct password sets the
  cookie and reveals the dashboard, and the dashboard 404s/redirects without the
  cookie. The gate is confirmed by running it, not by inspection.

## Operational runbook (refresh the numbers)

```bash
# in worldcup-predictor
.venv/bin/python -m worldcup.snapshot --bankroll 100 --sims 20000 \
  --out ../portfolio/src/data/worldcup-snapshot.json
# in portfolio
npm run deploy
```

## Out of scope (YAGNI)

- Live/auto-refreshing data (option B/C) — snapshot + redeploy is enough.
- Multiple users / per-user accounts — one shared password.
- Per-sim raw data export — only aggregated advancement probabilities are dumped.
- Head-to-head tiebreakers, model v2 calibration — predictor concerns, not this page.
