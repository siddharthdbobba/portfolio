# World Cup Predictor Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-locked `/worldcup` page to the portfolio site that visualizes the full World Cup predictor pipeline, fed by a JSON snapshot the predictor exports.

**Architecture:** The Python predictor gains an additive `snapshot` command that runs the real pipeline (plus a new detailed Monte Carlo that tracks how far each team advances) and writes a rich JSON file into `portfolio/src/data/` (gitignored — the repo is public). The Astro/Cloudflare site loads that JSON at build time into an SSR Worker route gated by an HMAC-signed session cookie, and renders six hand-rolled SVG/CSS visual components.

**Tech Stack:** Python 3.12 (numpy, scipy, httpx, pytest) for the predictor; Astro 6 + `@astrojs/cloudflare` SSR + Cloudflare Workers + Web Crypto + Vitest for the site. No charting library.

**Two repos:**
- `worldcup-predictor` at `/Users/sbobba/projects/worldcup-predictor` (Python). Run tests with `.venv/bin/pytest -q`.
- `portfolio` at `/Users/sbobba/projects/portfolio` (Astro). Spec lives at `docs/superpowers/specs/2026-06-02-worldcup-predictor-viz-design.md`.

**Commit each task** in its own repo. Predictor commits happen in the predictor repo; portfolio commits in the portfolio repo.

---

## File Structure

**`worldcup-predictor` (additive — existing agent path and tests untouched):**
- Modify `src/worldcup/blend.py` — extract a `market_weight()` helper (behavior-preserving).
- Modify `src/worldcup/simulator.py` — add `simulate_once_detailed()` + `run_simulation_detailed()`.
- Create `src/worldcup/snapshot.py` — pure `build_snapshot()` + a `__main__` CLI that fetches live data and writes JSON.
- Create `tests/test_blend_weight.py`, `tests/test_montecarlo_detailed.py`, `tests/test_snapshot.py`.

**`portfolio`:**
- Create `src/lib/worldcup-types.ts` — the snapshot TS type.
- Create `src/lib/worldcup-auth.ts` — Web Crypto HMAC sign/verify + constant-time compare.
- Create `src/lib/worldcup-data.ts` — `import.meta.glob` snapshot loader with sample fallback.
- Create `src/data/worldcup-snapshot.sample.json` — committed safe placeholder.
- Create `src/env.d.ts` — runtime env (`App.Locals.runtime`) types.
- Create `src/pages/api/worldcup-login.ts` — POST auth endpoint (`prerender = false`).
- Create `src/pages/worldcup.astro` — gated page (`prerender = false`).
- Create `src/components/worldcup/{PipelineStrip,RunMeta,EdgeChart,AdvancementFunnel,GroupGrid,BettingCard}.astro`.
- Create `tests/worldcup-auth.test.ts`, `tests/worldcup-data.test.ts`.
- Modify `.gitignore`, `package.json` (vitest), `tsconfig.json` if needed.

---

# PHASE 1 — Predictor: detailed simulation + snapshot export

### Task 1: Extract `market_weight()` helper in blend.py

**Files:**
- Modify: `/Users/sbobba/projects/worldcup-predictor/src/worldcup/blend.py`
- Test: `/Users/sbobba/projects/worldcup-predictor/tests/test_blend_weight.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_blend_weight.py
from worldcup.blend import market_weight, blend


def test_market_weight_matches_inline_formula():
    # w = w_cap * L/(L+K); defaults w_cap=0.7, K=0.5
    assert abs(market_weight(0.5) - 0.7 * (0.5 / 1.0)) < 1e-12
    assert market_weight(0.0) == 0.0
    assert market_weight(-5.0) == 0.0          # clamped at 0


def test_blend_still_uses_the_helper_equivalently():
    model = {"A": 0.6, "B": 0.4}
    market = {"A": 0.5, "B": 0.5}
    conf = {"A": 0.5, "B": 0.5}
    out = blend(model, market, conf, w_cap=0.7, K=0.5)
    w = market_weight(0.5)                       # 0.7 * 0.5/1.0 = 0.35
    raw_a = w * 0.5 + (1 - w) * 0.6
    raw_b = w * 0.5 + (1 - w) * 0.4
    total = raw_a + raw_b
    assert abs(out["A"] - raw_a / total) < 1e-9
    assert abs(out["B"] - raw_b / total) < 1e-9
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/sbobba/projects/worldcup-predictor && .venv/bin/pytest tests/test_blend_weight.py -v`
Expected: FAIL — `ImportError: cannot import name 'market_weight'`.

- [ ] **Step 3: Add the helper and refactor `blend` to use it**

In `src/worldcup/blend.py`, add above `blend()`:

```python
def market_weight(liquidity: float, w_cap: float = 0.7, K: float = 0.5) -> float:
    """Market blend weight for a priced team: w_cap * L/(L+K), clamped at L>=0.

    `liquidity` here is the market's normalized confidence (sum of the two books'
    [0,1] volumes, range [0,2]); K=0.5 is the blend's default half-saturation.
    """
    L = max(0.0, liquidity)
    return w_cap * (L / (L + K)) if (L + K) > 0 else 0.0
```

Then inside `blend()`, replace the inline weight computation:

```python
            if fixed_w is not None:
                w = fixed_w
            else:
                w = market_weight(liquidity.get(team, 0.0), w_cap=w_cap, K=K)
```

(Leave the `K: float = 1e6` default on `blend` unchanged — callers pass `K=0.5`.)

- [ ] **Step 4: Run tests to verify they pass (and nothing regressed)**

Run: `.venv/bin/pytest tests/test_blend_weight.py tests/test_blend.py -v`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
cd /Users/sbobba/projects/worldcup-predictor
git add src/worldcup/blend.py tests/test_blend_weight.py
git commit -m "refactor: extract market_weight helper from blend"
```

---

### Task 2: Detailed Monte Carlo that tracks advancement

**Files:**
- Modify: `/Users/sbobba/projects/worldcup-predictor/src/worldcup/simulator.py`
- Test: `/Users/sbobba/projects/worldcup-predictor/tests/test_montecarlo_detailed.py`

The new functions must consume the RNG in the **exact same order** as `simulate_once`/`run_simulation` so the champion sequence (and thus championship probabilities) stay identical for a given seed. Stage indices: `0=r32, 1=r16, 2=qf, 3=sf, 4=final, 5=champion` (2026 first KO round is R32).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_montecarlo_detailed.py
import numpy as np
from worldcup.models import MatchModelParams
from worldcup.simulator import (
    simulate_once, simulate_once_detailed, run_simulation, run_simulation_detailed,
    STAGES,
)


def _synthetic_world():
    groups, ratings = {}, {}
    n = 0
    for g in "ABCDEFGHIJKL":
        members = []
        for _ in range(4):
            name = f"T{n}"; ratings[name] = 1800.0; members.append(name); n += 1
        groups[g] = members
    ratings["T0"] = 2500.0  # dominant
    return groups, ratings


def test_detailed_champion_matches_simulate_once_rng_for_rng():
    groups, ratings = _synthetic_world()
    p = MatchModelParams()
    r1 = np.random.default_rng(3); r2 = np.random.default_rng(3)
    for _ in range(50):
        c1 = simulate_once(ratings, groups, r1, p)
        c2, reached = simulate_once_detailed(ratings, groups, r2, p)
        assert c1 == c2
        assert reached[c2] == 5                      # champion reached final stage


def test_advancement_is_monotone_and_normalized():
    groups, ratings = _synthetic_world()
    champ, adv = run_simulation_detailed(ratings, groups, n=300, seed=42)
    for team, stages in adv.items():
        seq = [stages[s] for s in STAGES]
        for earlier, later in zip(seq, seq[1:]):
            assert earlier + 1e-9 >= later           # r32 >= r16 >= ... >= champion
        for v in seq:
            assert 0.0 <= v <= 1.0
        assert abs(stages["champion"] - champ[team]) < 1e-9   # champion stage == champ prob
    # 32 teams reach the KO round each sim => total r32 mass ~= 32
    assert abs(sum(s["r32"] for s in adv.values()) - 32.0) < 1.0


def test_detailed_champion_probs_equal_run_simulation():
    groups, ratings = _synthetic_world()
    base = run_simulation(ratings, groups, n=300, seed=7)
    champ, _ = run_simulation_detailed(ratings, groups, n=300, seed=7)
    assert champ == base                              # identical, same rng order
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_montecarlo_detailed.py -v`
Expected: FAIL — `ImportError: cannot import name 'simulate_once_detailed'`.

- [ ] **Step 3: Implement the detailed simulation**

In `src/worldcup/simulator.py`, add (after `simulate_once`):

```python
STAGES = ("r32", "r16", "qf", "sf", "final", "champion")


def _play_knockout_tracked(seeded_teams, ratings, rng, p):
    """Play the seeded bracket, returning (champion, {team: deepest_stage_index}).

    Mirrors play_knockout's match order exactly so RNG consumption is identical.
    All seeded teams reach stage 0 (r32); each round's winners advance one stage.
    """
    order = bracket_seed_order(len(seeded_teams))
    bracket = [seeded_teams[s - 1] for s in order]
    reached = {t: 0 for t in bracket}              # everyone seeded reaches r32
    stage = 0
    while len(bracket) > 1:
        winners = [play_match_ko(bracket[i], bracket[i + 1], ratings, rng, p)
                   for i in range(0, len(bracket), 2)]
        stage += 1
        for w in winners:
            reached[w] = stage
        bracket = winners
    return bracket[0], reached


def simulate_once_detailed(ratings, groups, rng, p):
    """One tournament; return (champion, {team: deepest_stage_index}).

    Identical group/seeding logic and RNG order to simulate_once; only the
    knockout is played via the tracked variant. Teams that fail to qualify from
    their group are absent from `reached`.
    """
    qualifiers = []
    thirds = []
    for teams in groups.values():
        ranked, stats = simulate_group(teams, ratings, rng, p)
        qualifiers.append((ranked[0], stats[ranked[0]], 1))
        qualifiers.append((ranked[1], stats[ranked[1]], 2))
        thirds.append((ranked[2], stats[ranked[2]]))
    best_thirds = set(rank_thirds(thirds, rng))
    for name, stats in thirds:
        if name in best_thirds:
            qualifiers.append((name, stats, 3))
    seeded = [q[0] for q in sorted(
        qualifiers, key=lambda q: (q[2], *_rank_key(q[1], rng)))]
    return _play_knockout_tracked(seeded, ratings, rng, p)


def run_simulation_detailed(ratings, groups, n=DEFAULT_SIMS, seed=42, params=None):
    """Run n tournaments; return (champion_probs, advancement).

    champion_probs: {team: P(win)} over ALL teams in `ratings` (matches
    run_simulation exactly for the same seed/n). advancement: {team: {stage: P}}
    where stage in STAGES is cumulative (P of reaching at least that round).
    """
    p = params or MatchModelParams()
    rng = np.random.default_rng(seed)
    champ_counts = Counter()
    stage_counts = {t: [0] * len(STAGES) for t in ratings}
    for _ in range(n):
        champ, reached = simulate_once_detailed(ratings, groups, rng, p)
        champ_counts[champ] += 1
        for team, deepest in reached.items():
            for s in range(deepest + 1):
                stage_counts[team][s] += 1
    champion_probs = {t: champ_counts.get(t, 0) / n for t in ratings}
    advancement = {
        t: {STAGES[s]: stage_counts[t][s] / n for s in range(len(STAGES))}
        for t in ratings
    }
    return champion_probs, advancement
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_montecarlo_detailed.py tests/test_montecarlo.py -v`
Expected: PASS for all (existing montecarlo tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/worldcup/simulator.py tests/test_montecarlo_detailed.py
git commit -m "feat: detailed Monte Carlo tracking per-team advancement"
```

---

### Task 3: Pure `build_snapshot()`

**Files:**
- Create: `/Users/sbobba/projects/worldcup-predictor/src/worldcup/snapshot.py`
- Test: `/Users/sbobba/projects/worldcup-predictor/tests/test_snapshot.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_snapshot.py
from worldcup.models import BetRec, Forecast
from worldcup.snapshot import build_snapshot


def _inputs():
    groups = {"A": ["Spain", "Brazil", "Japan", "Ghana"]}
    ratings = {"Spain": 2090.0, "Brazil": 2050.0, "Japan": 1850.0, "Ghana": 1700.0,
               "Italy": 1990.0}  # extra (undrawn) team must be dropped
    market = {"Spain": 0.18, "Brazil": 0.16}
    ask = {"Spain": 0.19, "Brazil": 0.17}
    confidence = {"Spain": 0.5, "Brazil": 0.4}
    depth = {"Spain": 4000.0, "Brazil": 3000.0}
    forecasts = [Forecast("Spain", 0.20, 0.18, 0.19), Forecast("Brazil", 0.15, 0.16, 0.155)]
    advancement = {t: {"r32": 1.0, "r16": 0.5, "qf": 0.3, "sf": 0.2, "final": 0.1,
                       "champion": 0.05} for t in ["Spain", "Brazil", "Japan", "Ghana"]}
    bets = [BetRec("Spain", 0.19, 0.20, 0.18, 0.02, 0.05, 12.0, 51.2)]
    return (groups, ratings, market, ask, confidence, depth, forecasts, advancement, bets)


def test_build_snapshot_shape_with_bankroll():
    (groups, ratings, market, ask, conf, depth, forecasts, adv, bets) = _inputs()
    snap = build_snapshot(
        groups=groups, ratings=ratings, market=market, ask=ask, confidence=conf,
        depth=depth, forecasts=forecasts, advancement=adv, bets=bets,
        bankroll=100.0, n_sims=20000, seed=42, kelly_fraction=0.5, min_edge=0.05,
        generated_at="2026-06-02T00:00:00Z")
    assert set(snap) == {"meta", "draw", "ratings", "forecasts", "market",
                         "blend_weights", "advancement", "bankroll", "bets",
                         "staked", "reserve"}
    assert snap["draw"] == groups
    assert set(snap["ratings"]) == {"Spain", "Brazil", "Japan", "Ghana"}  # Italy dropped
    assert snap["forecasts"][0]["team"] == "Spain"
    assert set(snap["market"]["Spain"]) == {"prob", "ask", "confidence", "depth"}
    assert 0.0 <= snap["blend_weights"]["Spain"] <= 0.7
    assert snap["meta"]["n_sims"] == 20000
    assert snap["bankroll"] == 100.0
    assert snap["staked"] == 12.0
    assert snap["reserve"] == 88.0


def test_build_snapshot_without_bankroll_omits_card():
    (groups, ratings, market, ask, conf, depth, forecasts, adv, _bets) = _inputs()
    snap = build_snapshot(
        groups=groups, ratings=ratings, market=market, ask=ask, confidence=conf,
        depth=depth, forecasts=forecasts, advancement=adv, bets=[],
        bankroll=None, n_sims=10, seed=1, kelly_fraction=0.5, min_edge=0.05,
        generated_at="2026-06-02T00:00:00Z")
    assert snap["bankroll"] is None
    assert snap["bets"] == []
    assert snap["staked"] is None
    assert snap["reserve"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_snapshot.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'worldcup.snapshot'`.

- [ ] **Step 3: Implement `build_snapshot` (pure portion only)**

Create `src/worldcup/snapshot.py`:

```python
"""Export the predictor's full pipeline output as one JSON snapshot for the
portfolio site to visualize. `build_snapshot` is pure (no I/O); the CLI below
fetches live data and writes the file."""
from __future__ import annotations

from worldcup.blend import market_weight
from worldcup.models import BetRec, Forecast, MatchModelParams


def build_snapshot(*, groups, ratings, market, ask, confidence, depth,
                   forecasts, advancement, bets, bankroll, n_sims, seed,
                   kelly_fraction, min_edge, generated_at,
                   params: MatchModelParams | None = None) -> dict:
    """Assemble the snapshot dict. Only the 48 drawn teams are emitted; `ratings`
    may contain extras. `confidence` is the per-team market confidence (the blend
    weight input); `depth` is dollar order-book depth."""
    p = params or MatchModelParams()
    drawn = sorted({t for ts in groups.values() for t in ts})
    staked = round(sum(b.stake for b in bets), 2) if bankroll else None
    reserve = round(bankroll - staked, 2) if bankroll else None
    return {
        "meta": {
            "generated_at": generated_at,
            "n_sims": n_sims, "seed": seed, "kelly_fraction": kelly_fraction,
            "min_edge": min_edge,
            "model_params": {"base": p.base, "scale": p.scale,
                             "host_bump": p.host_bump, "hosts": list(p.hosts)},
            "sources": ["Polymarket", "Kalshi", "eloratings.net"],
        },
        "draw": {label: list(teams) for label, teams in groups.items()},
        "ratings": {t: ratings[t] for t in drawn},
        "forecasts": [
            {"team": f.team, "model_pct": f.model_pct,
             "market_pct": f.market_pct, "blended_pct": f.blended_pct}
            for f in forecasts
        ],
        "market": {
            t: {"prob": market.get(t, 0.0), "ask": ask.get(t, 0.0),
                "confidence": confidence.get(t, 0.0), "depth": depth.get(t, 0.0)}
            for t in drawn
        },
        "blend_weights": {
            t: market_weight(confidence.get(t, 0.0)) for t in drawn if t in market
        },
        "advancement": {t: advancement[t] for t in drawn if t in advancement},
        "bankroll": bankroll,
        "bets": [
            {"team": b.team, "ask": b.ask, "model_pct": b.model_pct,
             "market_pct": b.market_pct, "edge": b.edge, "ev_pct": b.ev_pct,
             "stake": b.stake, "potential_profit": b.potential_profit}
            for b in bets
        ],
        "staked": staked,
        "reserve": reserve,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_snapshot.py -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/worldcup/snapshot.py tests/test_snapshot.py
git commit -m "feat: pure build_snapshot for site export"
```

---

### Task 4: Snapshot CLI (fetch live data + write JSON)

**Files:**
- Modify: `/Users/sbobba/projects/worldcup-predictor/src/worldcup/snapshot.py`

This task talks to the network, so it is verified by running it, not a unit test.

- [ ] **Step 1: Add the CLI to `snapshot.py`**

Append to `src/worldcup/snapshot.py`:

```python
# --- CLI: fetch live data, run the pipeline, write JSON -----------------------
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from worldcup.blend import blend
from worldcup.draw import fetch_group_draw, validate_draw
from worldcup.markets import fetch_market_probabilities
from worldcup.models import Forecast
from worldcup.ratings import fetch_ratings
from worldcup.simulator import run_simulation_detailed
from worldcup.stake import recommend_bets

DEFAULT_OUT = "../portfolio/src/data/worldcup-snapshot.json"


def generate_snapshot(*, bankroll, n_sims, seed, kelly_fraction, min_edge) -> dict:
    """Fetch live draw/ratings/markets, run the detailed sim + pipeline, and build
    the snapshot dict. Raises loudly if markets are unavailable (no stale data)."""
    groups = fetch_group_draw()
    validate_draw(groups)
    ratings = fetch_ratings()
    valid = {t for ts in groups.values() for t in ts}
    missing = sorted(t for t in valid if t not in ratings)
    if missing:
        raise SystemExit(f"error: no Elo rating for drawn teams: {missing}")
    market, ask, confidence, depth = fetch_market_probabilities(valid_teams=valid)
    if not market:
        raise SystemExit("error: market fetch returned no priced teams; aborting "
                         "(refusing to ship a snapshot without live prices)")
    sub_ratings = {t: ratings[t] for t in valid}
    champ, advancement = run_simulation_detailed(sub_ratings, groups,
                                                 n=n_sims, seed=seed)
    blended = blend(champ, market, confidence, w_cap=0.7, K=0.5)
    forecasts = sorted(
        [Forecast(t, champ[t], market.get(t, 0.0), blended[t]) for t in champ],
        key=lambda f: f.blended_pct, reverse=True)
    bets = recommend_bets(champ, market, ask, bankroll,
                          kelly_fraction=kelly_fraction, liquidity=depth,
                          min_edge=min_edge) if bankroll else []
    return build_snapshot(
        groups=groups, ratings=ratings, market=market, ask=ask,
        confidence=confidence, depth=depth, forecasts=forecasts,
        advancement=advancement, bets=bets, bankroll=bankroll, n_sims=n_sims,
        seed=seed, kelly_fraction=kelly_fraction, min_edge=min_edge,
        generated_at=datetime.now(timezone.utc).isoformat())


def main() -> None:
    ap = argparse.ArgumentParser(description="Export a World Cup predictor snapshot")
    ap.add_argument("--bankroll", type=float, default=100.0,
                    help="Bankroll in dollars; pass 0 for a forecast-only snapshot")
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--kelly-fraction", type=float, default=0.5)
    ap.add_argument("--min-edge", type=float, default=0.05)
    ap.add_argument("--out", type=str, default=DEFAULT_OUT,
                    help=f"Output path (default {DEFAULT_OUT})")
    args = ap.parse_args()
    bankroll = args.bankroll if args.bankroll and args.bankroll > 0 else None
    snap = generate_snapshot(bankroll=bankroll, n_sims=args.sims, seed=args.seed,
                             kelly_fraction=args.kelly_fraction,
                             min_edge=args.min_edge)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=2) + "\n")
    n_bets = len(snap["bets"])
    print(f"wrote {out} — {len(snap['forecasts'])} teams, {n_bets} value bets, "
          f"generated_at {snap['meta']['generated_at']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the full predictor test suite (nothing regressed)**

Run: `.venv/bin/pytest -q`
Expected: PASS (all existing + new tests).

- [ ] **Step 3: Smoke-run the CLI for real (writes into the portfolio)**

Run: `cd /Users/sbobba/projects/worldcup-predictor && .venv/bin/python -m worldcup.snapshot --bankroll 100 --sims 2000`
Expected: prints `wrote ../portfolio/src/data/worldcup-snapshot.json — 48 teams, N value bets, generated_at ...`. (Use `--sims 2000` for a fast smoke run; the real export later uses 20000.)
Verify: `python3 -c "import json;d=json.load(open('/Users/sbobba/projects/portfolio/src/data/worldcup-snapshot.json'));print(sorted(d)); print(len(d['forecasts']))"` prints the 11 top-level keys and `48`.

- [ ] **Step 4: Commit (predictor only — the JSON lands in the gitignored portfolio path)**

```bash
git add src/worldcup/snapshot.py
git commit -m "feat: snapshot CLI exporting live pipeline JSON"
```

---

# PHASE 2 — Portfolio: auth, types, and data loader

### Task 5: Add Vitest to the portfolio

**Files:**
- Modify: `/Users/sbobba/projects/portfolio/package.json`

- [ ] **Step 1: Install vitest as a dev dependency**

Run: `cd /Users/sbobba/projects/portfolio && npm install -D vitest`
Expected: vitest added to `devDependencies`.

- [ ] **Step 2: Add a `test` script**

In `package.json` `"scripts"`, add:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Verify vitest runs (no tests yet is fine)**

Run: `npm test`
Expected: vitest reports "No test files found" (exit 0) or runs zero tests. Either is acceptable at this point.

- [ ] **Step 4: Commit**

```bash
cd /Users/sbobba/projects/portfolio
git add package.json package-lock.json
git commit -m "chore: add vitest for unit tests"
```

---

### Task 6: Snapshot TypeScript type

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/lib/worldcup-types.ts`

- [ ] **Step 1: Write the type (matches build_snapshot output exactly)**

```typescript
// src/lib/worldcup-types.ts
export interface Forecast {
  team: string;
  model_pct: number;
  market_pct: number;
  blended_pct: number;
}

export interface MarketRow {
  prob: number;
  ask: number;
  confidence: number;
  depth: number;
}

export interface Advancement {
  r32: number;
  r16: number;
  qf: number;
  sf: number;
  final: number;
  champion: number;
}

export interface Bet {
  team: string;
  ask: number;
  model_pct: number;
  market_pct: number;
  edge: number;
  ev_pct: number;
  stake: number;
  potential_profit: number;
}

export interface SnapshotMeta {
  generated_at: string;
  n_sims: number;
  seed: number;
  kelly_fraction: number;
  min_edge: number;
  model_params: { base: number; scale: number; host_bump: number; hosts: string[] };
  sources: string[];
}

export interface Snapshot {
  meta: SnapshotMeta;
  draw: Record<string, string[]>;
  ratings: Record<string, number>;
  forecasts: Forecast[];
  market: Record<string, MarketRow>;
  blend_weights: Record<string, number>;
  advancement: Record<string, Advancement>;
  bankroll: number | null;
  bets: Bet[];
  staked: number | null;
  reserve: number | null;
}

export const ADVANCEMENT_STAGES: { key: keyof Advancement; label: string }[] = [
  { key: "r32", label: "R32" },
  { key: "r16", label: "R16" },
  { key: "qf", label: "QF" },
  { key: "sf", label: "SF" },
  { key: "final", label: "Final" },
  { key: "champion", label: "Champion" },
];
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/sbobba/projects/portfolio && npx astro check 2>/dev/null || npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `worldcup-types.ts`. (If `astro check` isn't installed, the tsc fallback is fine.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/worldcup-types.ts
git commit -m "feat: snapshot TypeScript types"
```

---

### Task 7: Auth module (Web Crypto HMAC cookie)

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/lib/worldcup-auth.ts`
- Test: `/Users/sbobba/projects/portfolio/tests/worldcup-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/sbobba/projects/portfolio && npm test`
Expected: FAIL — cannot resolve `../src/lib/worldcup-auth`.

- [ ] **Step 3: Implement the auth module**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all auth tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/worldcup-auth.ts tests/worldcup-auth.test.ts
git commit -m "feat: HMAC-signed session token auth (Web Crypto)"
```

---

### Task 8: Sample snapshot + data loader + gitignore

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/data/worldcup-snapshot.sample.json`
- Create: `/Users/sbobba/projects/portfolio/src/lib/worldcup-data.ts`
- Create: `/Users/sbobba/projects/portfolio/tests/worldcup-data.test.ts`
- Modify: `/Users/sbobba/projects/portfolio/.gitignore`

- [ ] **Step 1: Gitignore the real snapshot (public repo — must not commit predictions)**

Append to `.gitignore`:

```
# World Cup predictor snapshot (generated locally, bundled into the Worker at
# build time; never committed — this repo is public).
src/data/worldcup-snapshot.json
```

- [ ] **Step 2: Create the committed safe sample (empty/placeholder shape)**

```json
{
  "meta": {
    "generated_at": "1970-01-01T00:00:00Z",
    "n_sims": 0,
    "seed": 0,
    "kelly_fraction": 0.5,
    "min_edge": 0.05,
    "model_params": { "base": 1.35, "scale": 2000.0, "host_bump": 60.0,
                      "hosts": ["United States", "Canada", "Mexico"] },
    "sources": ["Polymarket", "Kalshi", "eloratings.net"]
  },
  "draw": {},
  "ratings": {},
  "forecasts": [],
  "market": {},
  "blend_weights": {},
  "advancement": {},
  "bankroll": null,
  "bets": [],
  "staked": null,
  "reserve": null
}
```

- [ ] **Step 3: Write the failing test**

```typescript
// tests/worldcup-data.test.ts
import { describe, it, expect } from "vitest";
import { loadSnapshot, isEmptySnapshot } from "../src/lib/worldcup-data";

describe("loadSnapshot", () => {
  it("returns a snapshot object with the expected shape", () => {
    const { snapshot } = loadSnapshot();
    expect(snapshot).toHaveProperty("meta");
    expect(snapshot).toHaveProperty("forecasts");
    expect(Array.isArray(snapshot.forecasts)).toBe(true);
  });

  it("flags an empty (sample) snapshot via isEmptySnapshot", () => {
    const { snapshot } = loadSnapshot();
    // In the test environment the real file may be absent => sample => empty.
    expect(typeof isEmptySnapshot(snapshot)).toBe("boolean");
    expect(isEmptySnapshot({ ...snapshot, forecasts: [] })).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/lib/worldcup-data`.

- [ ] **Step 5: Implement the loader**

```typescript
// src/lib/worldcup-data.ts
import sample from "../data/worldcup-snapshot.sample.json";
import type { Snapshot } from "./worldcup-types";

// import.meta.glob returns {} when the file is absent (it's gitignored and only
// present after a local export), so a missing snapshot degrades to the sample
// instead of breaking the build. When present, Vite bundles it into the SSR
// Worker function — server-side only, never a public asset.
const real = import.meta.glob<{ default: Snapshot }>(
  "../data/worldcup-snapshot.json",
  { eager: true },
);

const REAL_KEY = "../data/worldcup-snapshot.json";

export function loadSnapshot(): { snapshot: Snapshot; isSample: boolean } {
  const mod = real[REAL_KEY] as { default: Snapshot } | undefined;
  if (mod?.default) return { snapshot: mod.default, isSample: false };
  return { snapshot: sample as Snapshot, isSample: true };
}

export function isEmptySnapshot(snapshot: Snapshot): boolean {
  return !snapshot.forecasts || snapshot.forecasts.length === 0;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (auth + data tests).

- [ ] **Step 7: Commit**

```bash
git add .gitignore src/data/worldcup-snapshot.sample.json src/lib/worldcup-data.ts tests/worldcup-data.test.ts
git commit -m "feat: snapshot data loader with sample fallback"
```

---

### Task 9: Runtime env types

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/env.d.ts`

- [ ] **Step 1: Declare the Cloudflare runtime env on App.Locals**

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/sbobba/projects/portfolio && npx astro check 2>/dev/null || npx tsc --noEmit`
Expected: no new errors. (`Astro.locals.runtime.env.WORLDCUP_PASSWORD` is now typed.)

- [ ] **Step 3: Commit**

```bash
git add src/env.d.ts
git commit -m "feat: typed Cloudflare runtime env for worldcup secrets"
```

---

# PHASE 3 — Portfolio: routes (login + gated page)

### Task 10: Login API route

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/pages/api/worldcup-login.ts`

- [ ] **Step 1: Write the POST handler**

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/sbobba/projects/portfolio && npx astro check 2>/dev/null || npx tsc --noEmit`
Expected: no errors in `worldcup-login.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/worldcup-login.ts
git commit -m "feat: worldcup login endpoint"
```

---

### Task 11: Gated page shell (auth gate + login form)

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/pages/worldcup.astro`

This task builds the gate and the login form; the dashboard body is a placeholder filled in by Task 18.

- [ ] **Step 1: Write the page with the auth gate and login form**

```astro
---
// src/pages/worldcup.astro
export const prerender = false; // MUST be on-demand: the gate runs per request.
import Base from "../layouts/Base.astro";
import { verifyToken } from "../lib/worldcup-auth";
import { loadSnapshot, isEmptySnapshot } from "../lib/worldcup-data";
import { COOKIE_NAME } from "./api/worldcup-login";

const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const env = Astro.locals.runtime?.env ?? {};
const cookieSecret = env.WORLDCUP_COOKIE_SECRET ?? "";
const token = Astro.cookies.get(COOKIE_NAME)?.value;
const authed = await verifyToken(token, cookieSecret, MAX_AGE_MS, Date.now());

const errorCode = Astro.url.searchParams.get("error");
const errorMsg =
  errorCode === "1" ? "Incorrect password." :
  errorCode === "config" ? "Server is not configured. Set the secrets and redeploy." :
  null;

let snapshot = null;
let unavailable = false;
if (authed) {
  const loaded = loadSnapshot();
  snapshot = loaded.snapshot;
  unavailable = loaded.isSample || isEmptySnapshot(snapshot);
}
---

<Base title="World Cup Predictor" description="A look inside the 2026 World Cup forecasting model.">
  {!authed ? (
    <main>
      <section class="section reveal">
        <div class="container wc-gate">
          <h1>World Cup Predictor</h1>
          <p class="lead" style="max-width: 440px;">
            This page is locked. Enter the password to see the model.
          </p>
          {errorMsg && <p class="wc-error mono">{errorMsg}</p>}
          <form class="wc-login card" method="POST" action="/api/worldcup-login">
            <label class="mono muted" for="wc-pw">password</label>
            <input id="wc-pw" name="password" type="password" autocomplete="current-password" required autofocus />
            <button class="btn btn-primary" type="submit">Unlock</button>
          </form>
        </div>
      </section>
    </main>
  ) : (
    <main>
      <section class="section reveal">
        <div class="container">
          <h1>World Cup Predictor</h1>
          {unavailable ? (
            <p class="wc-error mono">Snapshot unavailable — run the export and redeploy.</p>
          ) : (
            <!-- DASHBOARD: filled in by Task 18 -->
            <p class="mono muted">dashboard coming in Task 18</p>
          )}
        </div>
      </section>
    </main>
  )}
</Base>

<style>
  .wc-gate { display: flex; flex-direction: column; gap: 18px; }
  .wc-login {
    display: flex; flex-direction: column; gap: 12px;
    max-width: 360px; padding: 22px;
  }
  .wc-login input {
    background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; font: inherit;
  }
  .wc-login input:focus { outline: none; border-color: var(--accent); }
  .wc-error { color: #f87171; }
</style>
```

- [ ] **Step 2: Build to confirm the route is server-rendered (not prerendered)**

Run: `cd /Users/sbobba/projects/portfolio && npm run build`
Expected: build succeeds. Confirm `/worldcup` is NOT emitted as static HTML:
`test ! -f dist/worldcup/index.html && echo "OK: not prerendered" || echo "FAIL: prerendered"`
Expected: `OK: not prerendered`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/worldcup.astro
git commit -m "feat: gated worldcup page shell with login form"
```

---

# PHASE 4 — Visualization components

> All components are presentational Astro that take typed props from the snapshot. They are verified by `npm run build` (type/compile) and visually under `wrangler dev` in Task 19. Reuse existing tokens: `var(--bg-card)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--green)`, `var(--grad)`, `var(--radius)`.

### Task 12: PipelineStrip + RunMeta

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/components/worldcup/PipelineStrip.astro`
- Create: `/Users/sbobba/projects/portfolio/src/components/worldcup/RunMeta.astro`

- [ ] **Step 1: PipelineStrip**

```astro
---
// src/components/worldcup/PipelineStrip.astro
import type { Snapshot } from "../../lib/worldcup-types";
interface Props { snapshot: Snapshot }
const { snapshot } = Astro.props;
const teamCount = Object.keys(snapshot.ratings).length;
const pricedCount = Object.keys(snapshot.market).length;
const stages = [
  { label: "Draw", value: `${Object.keys(snapshot.draw).length} groups` },
  { label: "Elo ratings", value: `${teamCount} teams` },
  { label: "Market", value: `${pricedCount} priced` },
  { label: "Monte Carlo", value: `${snapshot.meta.n_sims.toLocaleString()} sims` },
  { label: "Blend", value: "model × market" },
  { label: "Kelly", value: `${snapshot.bets.length} bets` },
];
---
<ol class="wc-pipeline">
  {stages.map((s, i) => (
    <li class="wc-stage card">
      <span class="wc-stage-label mono muted">{s.label}</span>
      <span class="wc-stage-value">{s.value}</span>
      {i < stages.length - 1 && <span class="wc-stage-arrow" aria-hidden="true">→</span>}
    </li>
  ))}
</ol>
<style>
  .wc-pipeline {
    list-style: none; display: flex; flex-wrap: wrap; gap: 10px;
    padding: 0; margin: 0;
  }
  .wc-stage {
    position: relative; flex: 1 1 120px; padding: 12px 14px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .wc-stage-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .wc-stage-value { font-weight: 600; }
  .wc-stage-arrow {
    position: absolute; right: -11px; top: 50%; transform: translateY(-50%);
    color: var(--muted); z-index: 1;
  }
  @media (max-width: 640px) { .wc-stage-arrow { display: none; } }
</style>
```

- [ ] **Step 2: RunMeta**

```astro
---
// src/components/worldcup/RunMeta.astro
import type { Snapshot } from "../../lib/worldcup-types";
interface Props { snapshot: Snapshot }
const { snapshot } = Astro.props;
const m = snapshot.meta;
const asOf = new Date(m.generated_at).toLocaleString("en-US", {
  dateStyle: "medium", timeStyle: "short",
});
---
<p class="wc-meta mono muted">
  as of {asOf} · {m.n_sims.toLocaleString()} sims · seed {m.seed} ·
  Kelly {m.kelly_fraction}× · sources: {m.sources.join(", ")}
</p>
<style>
  .wc-meta { font-size: 0.78rem; }
</style>
```

- [ ] **Step 3: Build to type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/worldcup/PipelineStrip.astro src/components/worldcup/RunMeta.astro
git commit -m "feat: pipeline strip + run meta components"
```

---

### Task 13: EdgeChart (centerpiece — Model vs Market vs Blended)

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/components/worldcup/EdgeChart.astro`

- [ ] **Step 1: Write the component**

```astro
---
// src/components/worldcup/EdgeChart.astro
// Sorted horizontal bars per team: model / market / blended, with the
// model-vs-market disagreement (edge) called out.
import type { Snapshot } from "../../lib/worldcup-types";
interface Props { snapshot: Snapshot; top?: number }
const { snapshot, top = 16 } = Astro.props;
const rows = snapshot.forecasts.slice(0, top);
const max = Math.max(0.01, ...rows.flatMap((f) => [f.model_pct, f.market_pct, f.blended_pct]));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const w = (v: number) => `${(v / max) * 100}%`;
const series = [
  { key: "model_pct", label: "Model", color: "var(--accent)" },
  { key: "market_pct", label: "Market", color: "var(--muted)" },
  { key: "blended_pct", label: "Blended", color: "var(--green)" },
] as const;
---
<div class="wc-edge">
  <div class="wc-legend mono">
    {series.map((s) => (
      <span class="wc-legend-item"><i style={`background:${s.color}`}></i>{s.label}</span>
    ))}
    <span class="wc-legend-item wc-legend-edge">▲ = model sees value vs market</span>
  </div>
  {rows.map((f) => {
    const edge = f.model_pct - f.market_pct;
    return (
      <div class="wc-edge-row">
        <div class="wc-edge-team">
          <span class="wc-team-name">{f.team}</span>
          {edge > 0.01 && <span class="wc-edge-flag" title={`+${pct(edge)} vs market`}>▲ {pct(edge)}</span>}
        </div>
        <div class="wc-bars">
          {series.map((s) => (
            <div class="wc-bar-track">
              <div class="wc-bar" style={`width:${w(f[s.key])}; background:${s.color}`}></div>
              <span class="wc-bar-val mono">{pct(f[s.key])}</span>
            </div>
          ))}
        </div>
      </div>
    );
  })}
</div>
<style>
  .wc-edge { display: flex; flex-direction: column; gap: 14px; }
  .wc-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.75rem; color: var(--muted); }
  .wc-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .wc-legend-item i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .wc-legend-edge { color: var(--green); }
  .wc-edge-row {
    display: grid; grid-template-columns: 130px 1fr; gap: 12px; align-items: center;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .wc-edge-team { display: flex; flex-direction: column; gap: 2px; }
  .wc-team-name { font-weight: 600; }
  .wc-edge-flag { font-size: 0.72rem; color: var(--green); }
  .wc-bars { display: flex; flex-direction: column; gap: 4px; }
  .wc-bar-track { display: flex; align-items: center; gap: 8px; }
  .wc-bar { height: 9px; border-radius: 5px; min-width: 2px; transition: width 0.3s ease; }
  .wc-bar-val { font-size: 0.72rem; color: var(--muted); min-width: 48px; }
  @media (max-width: 540px) { .wc-edge-row { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Build to type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/worldcup/EdgeChart.astro
git commit -m "feat: model-vs-market-vs-blended edge chart"
```

---

### Task 14: AdvancementFunnel (inside the Monte Carlo)

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/components/worldcup/AdvancementFunnel.astro`

- [ ] **Step 1: Write the component**

```astro
---
// src/components/worldcup/AdvancementFunnel.astro
// Per-team probability of reaching each knockout stage (R32 -> Champion),
// for the top teams by championship probability.
import type { Snapshot } from "../../lib/worldcup-types";
import { ADVANCEMENT_STAGES } from "../../lib/worldcup-types";
interface Props { snapshot: Snapshot; top?: number }
const { snapshot, top = 8 } = Astro.props;
const teams = snapshot.forecasts.slice(0, top).map((f) => f.team);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
---
<div class="wc-funnel">
  <div class="wc-funnel-head mono muted">
    <span>Team</span>
    {ADVANCEMENT_STAGES.map((s) => <span class="wc-funnel-col">{s.label}</span>)}
  </div>
  {teams.map((team) => {
    const adv = snapshot.advancement[team];
    return (
      <div class="wc-funnel-row">
        <span class="wc-funnel-team">{team}</span>
        {ADVANCEMENT_STAGES.map((s) => {
          const v = adv ? adv[s.key] : 0;
          return (
            <span class="wc-funnel-cell" title={`${s.label}: ${pct(v)}`}>
              <span class="wc-funnel-fill" style={`opacity:${0.15 + v * 0.85}`}></span>
              <span class="wc-funnel-num mono">{pct(v)}</span>
            </span>
          );
        })}
      </div>
    );
  })}
</div>
<style>
  .wc-funnel { display: flex; flex-direction: column; gap: 4px; overflow-x: auto; }
  .wc-funnel-head, .wc-funnel-row {
    display: grid; grid-template-columns: 120px repeat(6, 1fr); gap: 4px; align-items: center;
    min-width: 520px;
  }
  .wc-funnel-head { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; padding-bottom: 4px; }
  .wc-funnel-col { text-align: center; }
  .wc-funnel-team { font-weight: 600; font-size: 0.9rem; }
  .wc-funnel-cell {
    position: relative; display: flex; align-items: center; justify-content: center;
    height: 34px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border);
  }
  .wc-funnel-fill { position: absolute; inset: 0; background: var(--grad); }
  .wc-funnel-num { position: relative; font-size: 0.74rem; color: var(--text); }
</style>
```

- [ ] **Step 2: Build to type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/worldcup/AdvancementFunnel.astro
git commit -m "feat: Monte Carlo advancement funnel"
```

---

### Task 15: GroupGrid (12×4, tinted by title odds)

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/components/worldcup/GroupGrid.astro`

- [ ] **Step 1: Write the component**

```astro
---
// src/components/worldcup/GroupGrid.astro
import type { Snapshot } from "../../lib/worldcup-types";
interface Props { snapshot: Snapshot }
const { snapshot } = Astro.props;
const titleOdds = new Map(snapshot.forecasts.map((f) => [f.team, f.blended_pct]));
const maxOdds = Math.max(0.01, ...snapshot.forecasts.map((f) => f.blended_pct));
const groups = Object.entries(snapshot.draw).sort(([a], [b]) => a.localeCompare(b));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
---
<div class="wc-groups">
  {groups.map(([label, teams]) => (
    <div class="wc-group card">
      <div class="wc-group-label mono muted">Group {label}</div>
      <ul class="wc-group-teams">
        {teams.map((team) => {
          const odds = titleOdds.get(team) ?? 0;
          return (
            <li class="wc-group-team">
              <span class="wc-group-dot" style={`opacity:${0.12 + (odds / maxOdds) * 0.88}`}></span>
              <span class="wc-group-name">{team}</span>
              <span class="wc-group-odds mono muted">{pct(odds)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  ))}
</div>
<style>
  .wc-groups {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;
  }
  .wc-group { padding: 12px 14px; }
  .wc-group-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .wc-group-teams { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .wc-group-team { display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center; }
  .wc-group-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--grad); }
  .wc-group-name { font-size: 0.88rem; }
  .wc-group-odds { font-size: 0.72rem; }
</style>
```

- [ ] **Step 2: Build to type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/worldcup/GroupGrid.astro
git commit -m "feat: group draw grid tinted by title odds"
```

---

### Task 16: BettingCard (Kelly bets)

**Files:**
- Create: `/Users/sbobba/projects/portfolio/src/components/worldcup/BettingCard.astro`

- [ ] **Step 1: Write the component**

```astro
---
// src/components/worldcup/BettingCard.astro
import type { Snapshot } from "../../lib/worldcup-types";
interface Props { snapshot: Snapshot }
const { snapshot } = Astro.props;
const { bets, bankroll, staked, reserve } = snapshot;
const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${pct(v)}`;
const DISCLAIMER =
  "Model-based estimate; prediction markets are highly efficient. For education only — never stake more than you can afford to lose.";
---
<div class="wc-betting">
  <div class="wc-betting-head">
    <h3>Betting card</h3>
    {bankroll != null && (
      <span class="mono muted">
        bankroll {money(bankroll)} · staked {money(staked ?? 0)} · reserve {money(reserve ?? 0)}
      </span>
    )}
  </div>
  {bets.length === 0 ? (
    <p class="mono muted">No value bets at current prices.</p>
  ) : (
    <div class="wc-bets">
      {bets.map((b) => (
        <div class="wc-bet card">
          <div class="wc-bet-team">{b.team}</div>
          <dl class="wc-bet-stats mono">
            <div><dt>ask</dt><dd>{b.ask.toFixed(2)}</dd></div>
            <div><dt>edge</dt><dd class="wc-pos">{signed(b.edge)}</dd></div>
            <div><dt>EV</dt><dd class="wc-pos">{signed(b.ev_pct)}</dd></div>
            <div><dt>stake</dt><dd>{money(b.stake)}</dd></div>
            <div><dt>profit</dt><dd>{money(b.potential_profit)}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  )}
  <p class="wc-disclaimer mono muted">{DISCLAIMER}</p>
</div>
<style>
  .wc-betting { display: flex; flex-direction: column; gap: 12px; }
  .wc-betting-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; justify-content: space-between; }
  .wc-betting-head span { font-size: 0.78rem; }
  .wc-bets { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .wc-bet { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .wc-bet-team { font-weight: 600; }
  .wc-bet-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 14px; margin: 0; font-size: 0.78rem; }
  .wc-bet-stats div { display: flex; justify-content: space-between; gap: 8px; }
  .wc-bet-stats dt { color: var(--muted); }
  .wc-bet-stats dd { margin: 0; }
  .wc-pos { color: var(--green); }
  .wc-disclaimer { font-size: 0.72rem; line-height: 1.5; }
</style>
```

- [ ] **Step 2: Build to type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/worldcup/BettingCard.astro
git commit -m "feat: Kelly betting card component"
```

---

### Task 17: Assemble the dashboard

**Files:**
- Modify: `/Users/sbobba/projects/portfolio/src/pages/worldcup.astro`

- [ ] **Step 1: Import the components and replace the Task-18 placeholder**

In the frontmatter (after the existing imports) add:

```astro
import PipelineStrip from "../components/worldcup/PipelineStrip.astro";
import RunMeta from "../components/worldcup/RunMeta.astro";
import EdgeChart from "../components/worldcup/EdgeChart.astro";
import AdvancementFunnel from "../components/worldcup/AdvancementFunnel.astro";
import GroupGrid from "../components/worldcup/GroupGrid.astro";
import BettingCard from "../components/worldcup/BettingCard.astro";
```

Replace the placeholder block:

```astro
            <!-- DASHBOARD: filled in by Task 18 -->
            <p class="mono muted">dashboard coming in Task 18</p>
```

with:

```astro
            <div class="wc-dash">
              <p class="lead" style="max-width: 560px;">
                A live look inside the 2026 World Cup model: how it draws the field,
                rates the teams, simulates the tournament, and where it disagrees with
                the betting market.
              </p>
              <RunMeta snapshot={snapshot!} />

              <div class="wc-block"><h2>The pipeline</h2><PipelineStrip snapshot={snapshot!} /></div>
              <div class="wc-block"><h2>Model vs market</h2><EdgeChart snapshot={snapshot!} /></div>
              <div class="wc-block"><h2>Inside the Monte Carlo</h2><AdvancementFunnel snapshot={snapshot!} /></div>
              <div class="wc-block"><h2>The draw</h2><GroupGrid snapshot={snapshot!} /></div>
              {snapshot!.bankroll != null && (
                <div class="wc-block"><BettingCard snapshot={snapshot!} /></div>
              )}
            </div>
```

Add to the page's `<style>` block:

```css
  .wc-dash { display: flex; flex-direction: column; gap: 12px; }
  .wc-block { margin-top: 26px; display: flex; flex-direction: column; gap: 14px; }
  .wc-block h2 { font-size: 1.15rem; }
```

- [ ] **Step 2: Build the whole site**

Run: `cd /Users/sbobba/projects/portfolio && npm run build`
Expected: build succeeds; `/worldcup` still server-rendered (`test ! -f dist/worldcup/index.html && echo OK`).

- [ ] **Step 3: Commit**

```bash
git add src/pages/worldcup.astro
git commit -m "feat: assemble worldcup dashboard"
```

---

# PHASE 5 — Integration, real data, deploy

### Task 18: Local end-to-end verification under wrangler dev

**Files:**
- Create: `/Users/sbobba/projects/portfolio/.dev.vars` (gitignored already via `.dev.vars*`)

- [ ] **Step 1: Generate a real snapshot (full 20k sims)**

Run:
```bash
cd /Users/sbobba/projects/worldcup-predictor
.venv/bin/python -m worldcup.snapshot --bankroll 100 --sims 20000 \
  --out ../portfolio/src/data/worldcup-snapshot.json
```
Expected: `wrote ../portfolio/src/data/worldcup-snapshot.json — 48 teams, N value bets, ...`.

- [ ] **Step 2: Set local dev secrets**

Create `/Users/sbobba/projects/portfolio/.dev.vars`:
```
WORLDCUP_PASSWORD = "choose-a-strong-password"
WORLDCUP_COOKIE_SECRET = "a-long-random-string-for-hmac"
```

- [ ] **Step 3: Build + run the Worker locally**

Run: `cd /Users/sbobba/projects/portfolio && npm run build && npx wrangler dev`
Expected: local server at `http://localhost:8787` (note the port).

- [ ] **Step 4: Exercise the gate in a browser (use Chrome via `http://localhost:8787`)**

> ⚠️ The session cookie is `Secure`. Chrome/Firefox treat `localhost` as a secure
> context and will store/send it over http, but **Safari will not**, and behavior
> over `http://127.0.0.1` is inconsistent. If login "succeeds" but the page keeps
> showing the form, that's the cause — not the auth logic. Test in **Chrome via
> `localhost`**.

- Visit `/worldcup` with no cookie → login form renders, NO predictor data in the page source.
- Submit a wrong password → redirected to `/worldcup?error=1`, "Incorrect password." shown, still no data.
- Submit the correct password → redirected to `/worldcup`, dashboard renders all sections (pipeline, edge chart, funnel, groups, betting card).
- Reload `/worldcup` → still authed (cookie persists).

- [ ] **Step 5: Discriminating leak test (this is the security proof — it must be able to fail)**

The authed dashboard markup (class `wc-dash`) and team names from the bundled
snapshot appear ONLY inside the authed branch. A real team name is the strongest
probe: it comes straight from the bundled JSON, so it surfaces in pre-auth HTML if
(and only if) the data actually leaked. Run from `/Users/sbobba/projects/portfolio`:

```bash
TEAM=$(python3 -c "import json;print(json.load(open('src/data/worldcup-snapshot.json'))['forecasts'][0]['team'])")
echo "probe team: $TEAM"

# 1) UNAUTHED — both markers must be ABSENT
curl -s http://localhost:8787/worldcup | grep -c "wc-dash"     # expect 0
curl -s http://localhost:8787/worldcup | grep -c "$TEAM"       # expect 0

# 2) Log in and capture the cookie value (explicit --cookie bypasses curl's
#    Secure-over-http filtering, which would otherwise drop the cookie on http)
TOKEN=$(curl -s -i -X POST http://localhost:8787/api/worldcup-login \
  --data-urlencode "password=choose-a-strong-password" \
  | grep -i '^set-cookie:' | sed -E 's/.*wc_auth=([^;]+).*/\1/' | tr -d '\r')
echo "token: ${TOKEN:0:12}..."

# 3) AUTHED — both markers must be PRESENT
curl -s --cookie "wc_auth=$TOKEN" http://localhost:8787/worldcup | grep -c "wc-dash"  # expect >=1
curl -s --cookie "wc_auth=$TOKEN" http://localhost:8787/worldcup | grep -c "$TEAM"    # expect >=1
```

Expected: step 1 prints `0` and `0` (no leak); step 3 prints `1`+ and `1`+ (data
shows only with the cookie). If step 1 prints anything but `0`, the data is leaking
pre-auth — STOP and fix the gate before deploying.

- [ ] **Step 6: Commit (nothing to commit if all green — snapshot + .dev.vars are gitignored)**

Confirm clean: `git status --porcelain` shows no tracked changes. If a tracked file changed, review and commit it.

---

### Task 19: Set production secrets and deploy

**Files:** none (operational)

- [ ] **Step 1: Set the Cloudflare secrets**

Run:
```bash
cd /Users/sbobba/projects/portfolio
npx wrangler secret put WORLDCUP_PASSWORD
npx wrangler secret put WORLDCUP_COOKIE_SECRET
```
Enter the same values you'll hand out / a long random HMAC secret. Expected: "Success! Uploaded secret ..." for each.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: build + `wrangler deploy` succeed; prints the deployed URL.

- [ ] **Step 3: Verify in production (same discriminating leak test, over https)**

```bash
cd /Users/sbobba/projects/portfolio
TEAM=$(python3 -c "import json;print(json.load(open('src/data/worldcup-snapshot.json'))['forecasts'][0]['team'])")

# UNAUTHED — must be absent
curl -s https://siddharthbobba.com/worldcup | grep -c "wc-dash"   # expect 0
curl -s https://siddharthbobba.com/worldcup | grep -c "$TEAM"     # expect 0

# AUTHED — over https a cookie jar works (Secure is satisfied)
curl -s -c /tmp/wc.txt -X POST https://siddharthbobba.com/api/worldcup-login \
  --data-urlencode "password=<the-production-password>" -o /dev/null
curl -s -b /tmp/wc.txt https://siddharthbobba.com/worldcup | grep -c "wc-dash"  # expect >=1
```

Then visit `https://siddharthbobba.com/worldcup` in a browser, enter the password,
and confirm the dashboard renders. If the unauthed grep is non-zero, the data is
public — STOP and fix before announcing the page.

- [ ] **Step 4: Final commit / wrap-up**

The feature is complete. The snapshot stays local (gitignored); to refresh numbers later, re-run the export (Task 18 Step 1) and `npm run deploy`.

---

## Operational runbook (refresh the numbers later)

```bash
# 1) regenerate the snapshot
cd /Users/sbobba/projects/worldcup-predictor
.venv/bin/python -m worldcup.snapshot --bankroll 100 --sims 20000 \
  --out ../portfolio/src/data/worldcup-snapshot.json
# 2) redeploy
cd /Users/sbobba/projects/portfolio && npm run deploy
```

---

## Self-review notes (coverage check)

- Spec "static snapshot" → Tasks 3–4, 8 (gitignored + bundled). ✓
- Spec "public repo, don't commit data" → Task 8 Step 1 gitignore + Task 18/19 verify no leak. ✓
- Spec "prerender = false on both routes" → Tasks 10 & 11 set it; Task 11/17 build-verify not prerendered. ✓
- Spec "secrets via runtime.env, Web Crypto" → Tasks 7, 9, 10, 11. ✓
- Spec "R32→Champion advancement, additive sim" → Task 2 (run_simulation untouched; STAGES start at r32). ✓
- Spec six visual components → Tasks 12–16; assembled in 17. ✓
- Spec "fails closed / graceful unavailable" → Task 7 (verifyToken), 10 (config error), 11 (unavailable state). ✓
- Spec "verify by running, not inspection" → Task 18 wrangler-dev checklist + a *discriminating* leak test (team name from the bundled JSON must be absent unauthed, present authed) that can actually fail; mirrored in Task 19. ✓
- Type consistency: `Snapshot`/`Advancement`/`Bet`/`MarketRow` defined in Task 6 are the exact prop types used in Tasks 12–17; `market[t]` keys `{prob, ask, confidence, depth}` match build_snapshot (Task 3) and `fetch_market_probabilities`. ✓
