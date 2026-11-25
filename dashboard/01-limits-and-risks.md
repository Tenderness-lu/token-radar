# Limits & risks: what this radar cannot do

- The median held-out miss is about 2.6x: treat every implied value as an order of magnitude, not a price. Held-out R² sits near or below zero because one or two protocols carry market caps that ignore TVL entirely.
- Launch odds are calibrated on 148 held-out protocols (five-fold Brier 0.201): 21% means about one in five similar protocols launched.
- Farm costs are estimates: capital $50–$250, gas $2–$8 a step. Real gas and slippage vary by chain and day.
- The snapshot is one day, 2026-11-14. TVL, growth and listings move after it; the board does not.
- A protocol recorded as tokenless may still have a token its record misses.
- Outlier test (radar-9): LOO residuals over 3.98 flagged bitway-earn, concentrator, gravity-bridge, obol and rain; dropping them and refitting with a tuned ridge won only 2 of 5 splits and moved 120 rows, so the base model keeps them.
- Nothing here is financial advice. Farm only what you can afford to lose.
