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
//   Fallback, so a quiet window still trades: if no buy has filled by bar 1200,
//     take one trend entry instead — 60-minute return at or above +0.2%, exit at
//     +0.8% / -1.0% / 180 bars. It never fires on the dev window (the bounce trades
//     happen first), so it changes nothing there; it only keeps a race window with
//     no deep drop from ending with zero trades.
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
const FALLBACK_BAR = 1200; // no filled buy by here: take one trend entry instead
const FALLBACK_WIN = 60; // bars of the trend that arms the fallback
const FALLBACK_THR = 0.002; // 60-minute return at or above +0.2%
const FALLBACK_TP = 0.008; // fallback exit at +0.8%
const FALLBACK_SL = 0.01; // fallback exit at -1.0%
const FALLBACK_HOLD = 180; // fallback exit after 180 bars

const closes: number[] = [];
let entryClose: number | null = null;
let entrySeq = -1;
let entryTp = TAKE_PROFIT;
let entrySl = STOP_LOSS;
let entryHold = MAX_HOLD;
let lastExitSeq = -1_000_000;
let everBought = false;

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
    for (const fill of batch.fills) {
      if (fill.symbol === SYMBOL && fill.side === "buy" && fill.status === "filled") everBought = true;
    }
    if (!fresh || state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    const seq = state.seq;
    const close = Number(state.close(SYMBOL));

    if (held !== undefined) {
      // Holding: exit on take-profit, stop-loss, or the hold limit.
      const up = close >= entryClose! * (1 + entryTp);
      const down = close <= entryClose! * (1 - entrySl);
      const stale = seq - entrySeq >= entryHold;
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
    if (drop !== null && drop <= DROP_THR) {
      const rev = ret(REV_WIN);
      if (rev !== null && rev >= REV_THR) {
        const cash = state.cash;
        if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        entryClose = close;
        entrySeq = seq;
        entryTp = TAKE_PROFIT;
        entrySl = STOP_LOSS;
        entryHold = MAX_HOLD;
        const buy: BuyInput = { side: "buy", symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [buy];
      }
    }

    // Fallback: no filled buy yet and the window is nearly over — take one
    // trend entry so the run still trades, with a tighter exit.
    if (!everBought && seq >= FALLBACK_BAR) {
      const trend = ret(FALLBACK_WIN);
      if (trend !== null && trend >= FALLBACK_THR) {
        const cash = state.cash;
        if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        entryClose = close;
        entrySeq = seq;
        entryTp = FALLBACK_TP;
        entrySl = FALLBACK_SL;
        entryHold = FALLBACK_HOLD;
        const buy: BuyInput = { side: "buy", symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [buy];
      }
    }
    return [];
  },
});
