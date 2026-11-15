// Dip-and-momentum long-only bot for cbBTC (CBBTC/USDC, 1-minute bars).
//
// Idea, from the dev window (24h, BTC -4% with one sharp V-shaped recovery):
// a long-only bot cannot profit from a grinding downtrend, so it stays in cash
// through the drift and only buys two kinds of move, both confirmed by a
// short-term turn back up (close above the close 5 bars ago):
//   Leg A — capitulation dip: the 60-bar return is at or below -200 bps
//     (a washout), buy the bounce. Exit at +3% take-profit, -1% stop, or
//     240 bars, whichever comes first.
//   Leg B — strong rally: the 60-bar return is at or above +200 bps with the
//     close above EMA(20), ride the momentum. Exit at +2% take-profit,
//     -1% stop, or 180 bars.
// A full-size round trip costs ~26 bps (4 bps fee + 2 bps slippage + ~7 bps
// impact each way at this pool's depth), so both legs only chase moves far
// larger than that. Exits are level-based, so an order the market refuses
// (slippage cap) is simply retried on the next bar while the level holds.
//
// Deterministic: float64 arithmetic on closes only; no clock, no randomness,
// no network, no files. The position and its cost basis are read back from
// the account each batch, so a rejected fill can never desync the state.

import { runBars, type BarsState, type Batch, type Bar, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 60; // bars for the 60-bar return
const TURN_BARS = 5; // turn-up confirmation: close above the close this many bars ago
const EMA_SPAN = 20;
const DROP_BPS = 200; // leg A: 60-bar return <= -200 bps
const RALLY_BPS = 200; // leg B: 60-bar return >= +200 bps
const STOP_FRAC = 0.01; // both legs: -1% stop-loss vs cost basis
const TP_A = 0.03; // leg A take-profit
const HOLD_A = 240; // leg A max hold, bars
const TP_B = 0.02; // leg B take-profit
const HOLD_B = 180; // leg B max hold, bars
const MAX_SLIPPAGE_BPS = 200; // 2% past the close the order was decided on

const closes: number[] = [];
let ema20: number | null = null;
const emaWarm: number[] = [];
let activeLeg: 'A' | 'B' | null = null;
let pendingLeg: 'A' | 'B' | null = null;
let entrySeq = -1;

function stepEma(close: number): void {
  if (ema20 !== null) {
    ema20 += (2 / (EMA_SPAN + 1)) * (close - ema20);
    return;
  }
  emaWarm.push(close);
  if (emaWarm.length === EMA_SPAN) ema20 = emaWarm.reduce((a, x) => a + x, 0) / EMA_SPAN;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    const sym = state.symbols.get(SYMBOL);
    if (sym === undefined) return [];
    // Fold this batch's CBBTC bar (if it carries one) into the indicators.
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const close = Number(bar.c) / 10 ** sym.price_scale;
      closes.push(close);
      stepEma(close);
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (activeLeg === null) {
        activeLeg = pendingLeg ?? 'A';
        pendingLeg = null;
        entrySeq = state.seq;
      }
      const value = state.value(SYMBOL, held.qty);
      const ret = Number(value) / Number(held.cost) - 1;
      const holdBars = state.seq - entrySeq;
      const tp = activeLeg === 'A' ? TP_A : TP_B;
      const maxHold = activeLeg === 'A' ? HOLD_A : HOLD_B;
      if (ret >= tp || ret <= -STOP_FRAC || holdBars >= maxHold) {
        activeLeg = null;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: look for an entry. Need enough history for the 60-bar return.
    activeLeg = null;
    const n = closes.length;
    if (n <= LOOKBACK || n <= TURN_BARS || ema20 === null) return [];
    const now = closes[n - 1];
    const ago60 = closes[n - 1 - LOOKBACK];
    const ago5 = closes[n - 1 - TURN_BARS];
    const r60bps = (now / ago60 - 1) * 10000;
    if (now <= ago5) return []; // no turn back up yet
    let leg: 'A' | 'B' | null = null;
    if (r60bps <= -DROP_BPS) leg = 'A';
    else if (r60bps >= RALLY_BPS && now > ema20) leg = 'B';
    if (leg === null) return [];
    if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    pendingLeg = leg;
    const buy: BuyInput = {
      side: 'buy',
      symbol: SYMBOL,
      notional_quote_units: state.cash,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    };
    return [buy];
  },
});
