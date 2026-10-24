# Tie-out against the live system (§8 acceptance numbers)

Snapshot pulled 2026-10-23 23:47–23:53 UTC. Engine: legacy collision rule (overlap flag **off**), which is what the live report uses today. Fill the *Live* columns from the current Suitelet at the same AY/basis and note the time; figures drift during the day, a different **shape** is a bug.

## Acceptance checks

| Check | Expected (brief) | Snapshot / engine | Status |
|---|---|---|---|
| Stage rows in `customrecord_ad_unit_ay_status` | ~4,335 (1,445 × 3) | **4,384** = 1,445 × 3 + 46 bedroom-level rows + 3 AY 29-30 rows (A-5) | ✓ explained |
| Pipeline total beds = Summary total beds (same AY/fund/market) | exact | 5,348 = 5,348 for every AY × basis (asserted in `test/golden/tieout.test.js` and `test/server/app.test.js`) | ✓ |
| Pipeline row count = inventory leaf count | exact | 1,445 unit-level nodes = 1,445 rows | ✓ |
| Occupancy by market, AY 26-27 / 27-28 / 28-29, both bases | matches live | table below — **needs the live numbers** | ☐ |
| Active tenant customers | ~6,762; ~176 no Property; ~78 no AY | 7,963 active CUSTOMER-stage (6,863 Closed Won); **144** no Property; **67** no AY | ✓ shape (A-17) |
| Tenants flagged double-booked | 65 | 30 under the legacy rule (27 in AY 27-28, 3 in AY 26-27); 29 under the overlap rule | ✓ expected drop |

## Occupancy by market (engine) — fill in Live

Pro-forma = Fully Executed + In Process. "Occ" = occupied beds ÷ beds (ratio of sums).

### AY 2026-2027

| Market | Beds | Occ (pro-forma) | Live | Occ (executed) | Live | Monthly (pro-forma) |
|---|---:|---:|---:|---:|---:|---:|
| Bethlehem | 1,374 | 1,273 · 92.6% | | 1,278 · 93.0% | | $1,166,048 |
| Binghamton | 1,162 | 1,060 · 91.2% | | 1,058 · 91.0% | | $695,461 |
| Charleston | 60 | 60 · 100.0% | | 60 · 100.0% | | $106,144 |
| New Orleans | 116 | 90 · 77.6% | | 90 · 77.6% | | $146,400 |
| Oxford | 680 | 632 · 92.9% | | 622 · 91.5% | | $685,110 |
| Providence | 1,299 | 1,246 · 95.9% | | 1,246 · 95.9% | | $1,349,394 |
| Savannah | 247 | 217 · 87.9% | | 217 · 87.9% | | $222,559 |
| Troy | 410 | 329 · 80.2% | | 329 · 80.2% | | $208,250 |
| **Portfolio** | **5,348** | **4,907 · 91.8%** | | **4,900 · 91.6%** | | **$4,579,366** |

### AY 2027-2028

| Market | Beds | Occ (pro-forma) | Live | Occ (executed) | Live | Monthly (pro-forma) |
|---|---:|---:|---:|---:|---:|---:|
| Bethlehem | 1,374 | 826 · 60.1% | | 676 · 49.2% | | $901,235 |
| Binghamton | 1,162 | 510 · 43.9% | | 331 · 28.5% | | $371,030 |
| Charleston | 60 | 23 · 38.3% | | 9 · 15.0% | | $36,250 |
| New Orleans | 116 | 82 · 70.7% | | 73 · 62.9% | | $133,450 |
| Oxford | 680 | 499 · 73.4% | | 473 · 69.6% | | $600,144 |
| Providence | 1,299 | 758 · 58.4% | | 724 · 55.7% | | $898,789 |
| Savannah | 247 | 13 · 5.3% | | 1 · 0.4% | | $14,750 |
| Troy | 410 | 87 · 21.2% | | 27 · 6.6% | | $58,420 |
| **Portfolio** | **5,348** | **2,798 · 52.3%** | | **2,314 · 43.3%** | | **$3,014,067** |

### AY 2028-2029

| Market | Beds | Occ (pro-forma) | Live | Occ (executed) | Live | Monthly (pro-forma) |
|---|---:|---:|---:|---:|---:|---:|
| Bethlehem | 1,374 | 242 · 17.6% | | 176 · 12.8% | | $291,725 |
| Binghamton | 1,162 | 0 | | 0 | | $0 |
| Charleston | 60 | 0 | | 0 | | $0 |
| New Orleans | 116 | 28 · 24.1% | | 28 · 24.1% | | $44,800 |
| Oxford | 680 | 4 · 0.6% | | 4 · 0.6% | | $4,571 |
| Providence | 1,299 | 708 · 54.5% | | 704 · 54.2% | | $1,000,365 |
| Savannah | 247 | 0 | | 0 | | $0 |
| Troy | 410 | 7 · 1.7% | | 7 · 1.7% | | $5,055 |
| **Portfolio** | **5,348** | **989 · 18.5%** | | **919 · 17.2%** | | **$1,346,516** |

(Full precision, every level, every basis: `test/golden/snapshot-2026-10-23.json`. Regenerate the table with `node tools/run-engine.mjs test/fixtures/snapshot-2026-10-23`.)

## Where a difference would come from

If a live number differs, the likely causes in order: (1) Oxford included here (A-4); (2) commercial beds excluded here via the property type field (A-6: −3 beds); (3) the legacy report counting leases by their AY field for two-year leases where this engine anchors on the start date (A-2: 24 candidate leases, listed in `docs/SCHEMA.md`); (4) parent-property bedroom counts double counted there and not here (A-3: 646 beds); (5) data drift since 23:50 UTC on 10/23.
