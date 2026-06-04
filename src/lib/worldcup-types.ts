// src/lib/worldcup-types.ts
export interface Forecast {
  team: string;
  model_pct: number;
  market_pct: number;
  blended_pct: number;
}

export interface MarketRow {
  prob: number;        // combined, volume-weighted consensus (de-vigged)
  ask: number;
  confidence: number;
  depth: number;
  polymarket: number | null; // this book's de-vigged win prob (null = not priced here)
  kalshi: number | null;
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
