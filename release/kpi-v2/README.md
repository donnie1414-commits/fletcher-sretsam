# Lease KPI Reporting v2 — patched Suitelet

`Serp_SL_Lease_KpiReporting_Hierarchy_v2.js` is the live v2 Suitelet (reporting-only build, as uploaded 2026-10-27) with one change: **frozen table headers**. Every table wrapper (`#lkr .wrap`) now scrolls inside the viewport instead of with the page, so the header rows stay visible while scrolling down and the Total row stays at the bottom. Short tables are unaffected. The change is eleven CSS lines after `#lkr .wrap.scroll thead th{…}` in the `STYLES` block; no query, rule or markup changed.

The library (`Serp_Lease_KpiReporting_Hierarchy_LIB_v2.js`) is untouched: v2 reads the lease status, not the leasing stage, so the new **Lease Revisions** stage used by the Leasing Hub needs nothing in v2.

Upload: File Cabinet › open the existing Suitelet file › Edit › Select File › replace. The script record and deployment do not change.
