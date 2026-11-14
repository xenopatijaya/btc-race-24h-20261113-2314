// Bounce bot for btc-race-24h-20261113-2314: "Race a BTC trading bot live for 24 hours".
//
// Idea, from the dev window (BTC fell 4.9% over 24h, every kit baseline lost money):
// 1-minute returns on this pool are mean-reverting at short horizons (after a +0.3%
// 15-minute rise the next 15 minutes average -10 bps), while sharp multi-hour drops
// are followed by V-shaped bounces. Trend-following (EMA cross, the kit baseline)
// whipsaws: 58 trades, -$109. So this bot does the opposite of chasing: it sits in
// cash through declines and buys only the first sign of a reversal after a deep drop.
//
//   Entry (flat only): the 120-minute return is at or below -1.6% AND the 10-minute
//     return is at or above +0.15% (the bounce has started), at least 60 bars after
//     the last exit, full cash.
//   Exit (whole position): +1.05% above the entry close, or -2.0% below it (safety
//     stop, never triggered on the dev window), or 600 bars after entry, whichever
//     comes first. No trailing stop: on the dev window the bounce's first leg is the
//     reliable part and trailing stops gave the gains back.
//
// Dev-window result (official grade-local, --driver process): net PnL +$15.96,
// max drawdown 1.7%, 4 trades (2 round trips), fees $1.61. Baselines on the same
// window: buy-and-hold -$52.59, ema-cross -$109.38, adx-momentum -$50.31,
// rsi-bollinger -$65.83, momentum -$49.23.
//
// Deterministic: pure float64 arithmetic on the closes the harness sends, no clock,
// no randomness, no network, no files. One order per reply at most, max slippage
// 100 bps (1%) past the close the order was decided on.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const DROP_WIN = 120; // bars of the drop that sets the bounce up
const DROP_THR = -0.016; // 120-minute return at or below -1.6%
const REV_WIN = 10; // bars of the reversal that confirms the bounce
const REV_THR = 0.0015; // 10-minute return at or above +0.15%
const TAKE_PROFIT = 0.0105; // exit at +1.05% over the entry close
const STOP_LOSS = 0.02; // safety exit at -2.0% under the entry close
const MAX_HOLD = 600; // bars after entry, exit whatever the price
const COOLDOWN = 60; // bars after an exit before the next entry
const MAX_SLIPPAGE_BPS = 100;

const closes: number[] = [];
let entryClose: number | null = null;
let entrySeq = -1;
let lastExitSeq = -1_000_000;

function ret(win: number): number | null {
  const n = closes.length;
  if (n <= win) return null;
  const now = closes[n - 1];
  const then = closes[n - 1 - win];
  if (then === 0) return null;
  return now / then - 1;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      closes.push(Number(bar.c));
      fresh = true;
    }
    if (!fresh || state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    const seq = state.seq;
    const close = Number(state.close(SYMBOL));

    if (held !== undefined) {
      // Holding: exit on take-profit, stop-loss, or the hold limit.
      const up = close >= entryClose! * (1 + TAKE_PROFIT);
      const down = close <= entryClose! * (1 - STOP_LOSS);
      const stale = seq - entrySeq >= MAX_HOLD;
      if (up || down || stale) {
        lastExitSeq = seq;
        entryClose = null;
        const sell: SellInput = { side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: enter only after a deep drop plus a fresh reversal, past the cooldown.
    if (seq - lastExitSeq < COOLDOWN) return [];
    const drop = ret(DROP_WIN);
    if (drop === null || drop > DROP_THR) return [];
    const rev = ret(REV_WIN);
    if (rev === null || rev < REV_THR) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryClose = close;
    entrySeq = seq;
    const buy: BuyInput = { side: "buy", symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
