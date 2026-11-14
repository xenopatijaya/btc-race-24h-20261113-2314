# BTC Bounce Bot — btc-race-24h-20261113-2314

A bot that trades cbBTC/USDC 1-minute bars (Orca Whirlpool, Solana) with $1,000
paper money, long only, for the make.fun "Race a BTC trading bot live for 24 hours"
competition.

## Strategy

1-minute returns on this pool are mean-reverting at short horizons, while sharp
multi-hour drops are followed by V-shaped bounces. Trend-following whipsaws here
(the kit's EMA-cross baseline: 58 trades, -$109 on the dev window), so this bot
sits in cash through declines and buys only the first sign of a reversal after a
deep drop:

- **Entry:** 120-minute return ≤ -1.6% **and** 10-minute return ≥ +0.15%,
  at least 60 bars after the last exit, full cash.
- **Exit (whole position):** +1.05% over the entry close, or -2.0% under it
  (safety stop), or 600 bars after entry.
- **Fallback:** if no buy has filled by bar 1200, take one trend entry instead
  (60-minute return ≥ +0.2%, exit +0.8% / -1.0% / 180 bars) so a quiet window
  still trades. It never fires on the dev window.

## Dev-window result (official `grade-local`, `--driver process`)

| | |
|---|---|
| Net PnL | **+$15.96** |
| Max drawdown | 1.7% |
| Trades | 4 (2 round trips) |
| Fees | $1.61 |

Baselines on the same window: buy-and-hold -$52.59, ema-cross -$109.38,
adx-momentum -$50.31, rsi-bollinger -$65.83, momentum -$49.23, hold-cash $0.

## Layout

- `main.ts` — the bot (Node 22, TypeScript, erasable syntax).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `agent-fun/bars-replay/v1` SDK shim.
- `LICENSE` — MIT. `.makefun/owner.json` — entry ownership claim.

Deterministic: pure float64 arithmetic on the closes the harness sends; no clock,
no randomness, no network, no files outside the repository.
