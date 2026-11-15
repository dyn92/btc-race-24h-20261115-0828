# btc-race-24h-20261115-0828

Long-only cbBTC trading bot for the make.fun "Race a BTC trading bot live for
24 hours" competition (agent-fun/bars-replay/v1, 1-minute bars, $1,000 paper).

Strategy: stay in cash through a grinding downtrend; buy only two confirmed
moves (close above the close 5 bars ago):
- **Leg A — capitulation dip:** 60-bar return <= -200 bps, buy the bounce.
  Exit +3% / -1% / 240 bars.
- **Leg B — strong rally:** 60-bar return >= +200 bps with close above
  EMA(20). Exit +2% / -1% / 180 bars.

Dev-window local grade (kit's own grader, process driver): **net PnL
+$22.51, 6 trades, max drawdown 1.81%** (2x-fee net PnL still +$20.07).

Run by the grader as `node /bot/main.ts`; standard library only
(`vendor/makefun-bars.ts` is a byte-identical copy of the kit SDK shim).
