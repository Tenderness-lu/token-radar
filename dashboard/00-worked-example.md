# Worked example: how one implied value is priced

The board's model is one fitted regression, not a made-up multiple. This file
prices the board's top protocol term by term, then lists the ten best farms by
expected value (implied value x launch odds, minus farm costs).

## Sentora Curator, rank 1 (Risk Curators, Ethereum / Ink / Solana / Tempo)

Snapshot record: TVL $2,757,585,593, 7-day change +2.37%, listed 407 days ago
(1.12 years), no token recorded. Fitted equation:

    ln(implied value) = 10.541 + 0.342 ln(TVL) + 0.008 tanh(7d growth / 30)
                        - 0.176 age in years

Term by term:

    ln(TVL) = ln($2,757,585,593) = 21.74, x 0.342 = 7.43
    tanh(2.37 / 30) = 0.079, x 0.008 = 0.00
    age 1.12 years x -0.176 = -0.20
    intercept = 10.54
    ln(implied value) = 10.54 + 7.43 + 0.00 - 0.20 = 17.77
    implied value = e^17.77 = $52,420,239

Launch odds (logistic, fitted on all 758 protocols): 21%. Gross expected value
$52,420,239 x 21% = $11,008,250. Farm costs $176 ($150 capital, $8 setup gas,
$10 weekly gas over 5 weeks, $5 buffer). Net expected value $11,008,074.

## Top ten farms by expected value

| # | Protocol | Implied value | Launch odds | Farm net EV |
|---|----------|--------------:|------------:|------------:|
| 1 | Veda | $38,638,988 | 80% | $31,026,931 |
| 2 | USDD | $34,178,291 | 66% | $22,591,674 |
| 3 | Upshift | $25,297,637 | 74% | $18,745,427 |
| 4 | Steakhouse Financial | $49,016,991 | 33% | $16,322,482 |
| 5 | BitFi Basis | $19,545,105 | 73% | $14,306,895 |
| 6 | CIAN Yield Layer | $20,591,921 | 69% | $14,270,079 |
| 7 | Lagoon | $16,926,383 | 79% | $13,422,500 |
| 8 | Defi Saver Asset Management | $17,943,645 | 75% | $13,421,720 |
| 9 | Mellow Core | $23,751,568 | 56% | $13,372,007 |
| 10 | b14g | $17,640,457 | 75% | $13,247,861 |

The board ranks by implied value; the farm ranking above is different on
purpose. Sentora Curator is #1 by implied value but only #21 by expected value
($11,008,074): a 21% launch chance cuts its $52.4M to $11.0M, while Veda's 80%
keeps most of its $38.6M. Sort the board by Farm net EV to farm by expected
value instead of headline value.

Validation (held out, same fit for every row): random 80/20 median |log error|
0.95, leave-one-category-out 0.82, leave-one-out 0.97. Launch odds Brier:
extended logistic 0.201 five-fold, plain logistic 0.202, old table 0.223.
