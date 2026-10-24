# Overlap rule (§5.7.1) — before / after delta

Fixture: `test/fixtures/live` pulled 2026-10-23T23:53:46.026Z. Tolerance: 7 days. Generated 2026-10-24.

Before = today's rule (any two leases on one scope in one AY collide, both excluded). After = collisions require date overlap; overlaps ≤ 7 days are tolerated as turnover and both leases count once; sequential leases sum revenue and cap months at 12.

## AY 2026-2027 · Pro-forma

| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Binghamton | 1162 | 1060 | 1062 | +2 | 91.2% | 91.4% | $695,461 | $697,961 | +$2,500 | +$20,600 |
| Bethlehem | 1374 | 1273 | 1281 | +8 | 92.6% | 93.2% | $1,166,048 | $1,174,748 | +$8,700 | +$81,300 |
| Oxford | 680 | 632 | 634 | +2 | 92.9% | 93.2% | $685,110 | $688,338 | +$3,228 | +$33,200 |
| Providence | 1299 | 1246 | 1262 | +16 | 95.9% | 97.2% | $1,349,394 | $1,387,369 | +$37,975 | +$226,625 |
| Savannah | 247 | 217 | 218 | +1 | 87.9% | 88.3% | $222,559 | $225,159 | +$2,600 | +$26,000 |
| Troy | 410 | 329 | 330 | +1 | 80.2% | 80.5% | $208,250 | $209,385 | +$1,135 | +$7,810 |
| **Portfolio** | 5348 | 4907 | 4937 | +30 | 91.8% | 92.3% | $4,579,366 | $4,635,504 | +$56,138 | +$395,535 |

| Exception | before | after |
|---|---:|---:|
| MULTI_BED | 4 | 0 |
| MULTI_UNIT | 10 | 0 |
| NO_STATUS | 18 | 18 |
| PROP_HAS_WH | 2 | 0 |
| TENANT_DOUBLE | 10 | 4 |
| TERM_MISMATCH | 1 | 1 |
| WH_PLUS | 1 | 0 |
| ZERO_BEDS | 3 | 3 |
| tenants flagged double-booked | 5 | 2 |

<details><summary>17 leases change status</summary>

| Lease | Dates | Beds | Monthly | Before | After |
|---|---|---:|---:|---|---|
| 260WAS2R - AY 2026-2027 (381) | 2026-06-01 → 2026-07-23 | 1 | $550 | MULTI_BED | placed |
| 418E_5A - AY 2026-2027 (683) | 2026-06-15 → 2026-12-31 | 5 | $4,200 | MULTI_UNIT | placed |
| 55WAL33 - AY 2026-2027 (1076) | 2026-08-01 → 2026-10-31 | 1 | $675 | MULTI_UNIT | placed |
| 219W31B - AY 2026-2027 (1141) | 2026-09-01 → 2026-12-31 | 1 | $1,300 | MULTI_UNIT | placed |
| ADM413D - AY 2026-2027 (1147) | 2026-08-01 → 2026-10-31 | 3 | $1,200 | MULTI_UNIT | placed |
| 260WAS2R 2 - AY 2026-2027 (1765) | 2026-08-03 → 2027-05-25 | 1 | $600 | MULTI_BED | placed |
| 32VEN1 SPRING - AY 2026-2027 (1771) | 2027-01-03 → 2027-05-25 | 8 | $9,800 | PROP_HAS_WH | placed TENANT_DOUBLE |
| 32VEN2 SPRING - AY 2026-2027 (1772) | 2027-01-03 → 2027-05-25 | 8 | $9,800 | PROP_HAS_WH | placed TENANT_DOUBLE+TENANT_DOUBLE |
| 10711TH2 2C - AY 2026-2027 (1778) | 2026-07-01 → 2026-09-30 | 1 | $635 | MULTI_BED | placed |
| 32VEN-WH FALL - AY 2026-2027 (2045) | 2026-06-23 → 2026-12-27 | 16 | $18,375 | WH_PLUS | placed |
| 107 11th 2C AY 2026-2027 (2232) | 2026-10-01 → 2027-05-16 | 1 | $500 | MULTI_BED | placed |
| 55 Walnut St Unit 33 AY 26/27 (Nov start) (2395) | 2026-11-01 → 2027-07-27 | 1 | $675 | MULTI_UNIT | placed |
| 219 W 31st Unit B AY26/27 (2909) | 2027-01-04 → 2027-07-31 | 1 | $1,300 | MULTI_UNIT | placed |
| 413 Adams Unit D AY 2026-2027 (4465) | 2026-11-01 → 2027-05-25 | 3 | $1,200 | MULTI_UNIT | placed |
| 418 e 5th A AY 26-27 (4473) | 2027-01-01 → 2027-05-25 | 5 | $2,100 | MULTI_UNIT | placed |
| 218POPL1A - AY 2026-2027 (4632) | 2026-08-19 → 2027-05-17 | 2 | $1,844 | MULTI_UNIT | placed |
| 218POPL1A - AY 2027-2028 (6502) | 2027-05-24 → 2029-05-24 | 2 | $1,383 | MULTI_UNIT | placed |

</details>

## AY 2026-2027 · Fully Executed

| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Binghamton | 1162 | 1058 | 1060 | +2 | 91.0% | 91.2% | $694,711 | $697,211 | +$2,500 | +$20,600 |
| Bethlehem | 1374 | 1278 | 1281 | +3 | 93.0% | 93.2% | $1,170,248 | $1,172,648 | +$2,400 | +$20,400 |
| Oxford | 680 | 622 | 624 | +2 | 91.5% | 91.8% | $676,444 | $679,671 | +$3,228 | +$33,200 |
| Providence | 1299 | 1246 | 1262 | +16 | 95.9% | 97.2% | $1,349,394 | $1,387,369 | +$37,975 | +$226,625 |
| Troy | 410 | 329 | 330 | +1 | 80.2% | 80.5% | $208,250 | $209,385 | +$1,135 | +$7,810 |
| **Portfolio** | 5348 | 4900 | 4924 | +24 | 91.6% | 92.1% | $4,574,300 | $4,621,538 | +$47,238 | +$308,635 |

| Exception | before | after |
|---|---:|---:|
| MULTI_BED | 4 | 0 |
| MULTI_UNIT | 6 | 0 |
| NO_STATUS | 18 | 18 |
| PROP_HAS_WH | 2 | 0 |
| TENANT_DOUBLE | 8 | 4 |
| TERM_MISMATCH | 1 | 1 |
| WH_PLUS | 1 | 0 |
| ZERO_BEDS | 3 | 3 |
| tenants flagged double-booked | 4 | 2 |

<details><summary>13 leases change status</summary>

| Lease | Dates | Beds | Monthly | Before | After |
|---|---|---:|---:|---|---|
| 260WAS2R - AY 2026-2027 (381) | 2026-06-01 → 2026-07-23 | 1 | $550 | MULTI_BED | placed |
| 55WAL33 - AY 2026-2027 (1076) | 2026-08-01 → 2026-10-31 | 1 | $675 | MULTI_UNIT | placed |
| ADM413D - AY 2026-2027 (1147) | 2026-08-01 → 2026-10-31 | 3 | $1,200 | MULTI_UNIT | placed |
| 260WAS2R 2 - AY 2026-2027 (1765) | 2026-08-03 → 2027-05-25 | 1 | $600 | MULTI_BED | placed |
| 32VEN1 SPRING - AY 2026-2027 (1771) | 2027-01-03 → 2027-05-25 | 8 | $9,800 | PROP_HAS_WH | placed TENANT_DOUBLE |
| 32VEN2 SPRING - AY 2026-2027 (1772) | 2027-01-03 → 2027-05-25 | 8 | $9,800 | PROP_HAS_WH | placed TENANT_DOUBLE+TENANT_DOUBLE |
| 10711TH2 2C - AY 2026-2027 (1778) | 2026-07-01 → 2026-09-30 | 1 | $635 | MULTI_BED | placed |
| 32VEN-WH FALL - AY 2026-2027 (2045) | 2026-06-23 → 2026-12-27 | 16 | $18,375 | WH_PLUS | placed |
| 107 11th 2C AY 2026-2027 (2232) | 2026-10-01 → 2027-05-16 | 1 | $500 | MULTI_BED | placed |
| 55 Walnut St Unit 33 AY 26/27 (Nov start) (2395) | 2026-11-01 → 2027-07-27 | 1 | $675 | MULTI_UNIT | placed |
| 413 Adams Unit D AY 2026-2027 (4465) | 2026-11-01 → 2027-05-25 | 3 | $1,200 | MULTI_UNIT | placed |
| 218POPL1A - AY 2026-2027 (4632) | 2026-08-19 → 2027-05-17 | 2 | $1,844 | MULTI_UNIT | placed |
| 218POPL1A - AY 2027-2028 (6502) | 2027-05-24 → 2029-05-24 | 2 | $1,383 | MULTI_UNIT | placed |

</details>

## AY 2027-2028 · Pro-forma

| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Portfolio** | 5348 | 2798 | 2798 | 0 | 52.3% | 52.3% | $3,014,067 | $3,014,067 | $0 | $0 |

| Exception | before | after |
|---|---:|---:|
| MULTI_BED | 3 | 3 |
| MULTI_UNIT | 4 | 4 |
| NO_STATUS | 49 | 49 |
| PROP_HAS_WH | 2 | 2 |
| TENANT_DOUBLE | 54 | 54 |
| UNIT_ON_BED | 1 | 1 |
| WH_MULTI | 2 | 2 |
| WH_PLUS | 1 | 1 |
| ZERO_BEDS | 2 | 2 |
| tenants flagged double-booked | 27 | 27 |

## AY 2027-2028 · Fully Executed

| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Portfolio** | 5348 | 2314 | 2314 | 0 | 43.3% | 43.3% | $2,611,287 | $2,611,287 | $0 | $0 |

| Exception | before | after |
|---|---:|---:|
| NO_STATUS | 49 | 49 |
| ZERO_BEDS | 2 | 2 |
| tenants flagged double-booked | 0 | 0 |

## AY 2028-2029 · Pro-forma

| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Portfolio** | 5348 | 989 | 989 | 0 | 18.5% | 18.5% | $1,346,516 | $1,346,516 | $0 | $0 |

| Exception | before | after |
|---|---:|---:|
| NO_STATUS | 7 | 7 |
| ZERO_BEDS | 2 | 2 |
| tenants flagged double-booked | 0 | 0 |

## AY 2028-2029 · Fully Executed

| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Portfolio** | 5348 | 919 | 919 | 0 | 17.2% | 17.2% | $1,271,766 | $1,271,766 | $0 | $0 |

| Exception | before | after |
|---|---:|---:|
| NO_STATUS | 7 | 7 |
| ZERO_BEDS | 2 | 2 |
| tenants flagged double-booked | 0 | 0 |

## Summary

| AY | Basis | Δ occupied beds | Δ monthly | Δ annual | Double-booked tenants before → after |
|---|---|---:|---:|---:|---|
| 2026-2027 | proforma | +30 | +$56,138 | +$395,535 | 5 → 2 |
| 2026-2027 | executed | +24 | +$47,238 | +$308,635 | 4 → 2 |
| 2027-2028 | proforma | 0 | $0 | $0 | 27 → 27 |
| 2027-2028 | executed | 0 | $0 | $0 | 0 → 0 |
| 2028-2029 | proforma | 0 | $0 | $0 | 0 → 0 |
| 2028-2029 | executed | 0 | $0 | $0 | 0 → 0 |

**Sign-off:** ☐ approved to make `requireOverlapForCollision: true` the default (constants.js FEATURE_FLAGS). Not shipped until this box is ticked by Amicus.
