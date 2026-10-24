# Amicus Leasing Workspace — v3 rebuild

Internal NetSuite Suitelet for Amicus Properties' asset-management and leasing teams. This repository holds the rebuild; `app.html` / `index.html` at the root are the previous implementation and are not read or used by anything here.

Start with `docs/STATUS.md`. Then `docs/LEAD-DISCOVERY.md` (needs review), `docs/TIE-OUT.md` (needs live numbers), `docs/OVERLAP-DELTA.md` (needs sign-off), `docs/ASSUMPTIONS.md`.

```
src/server      Suitelet entry, routes, DAO (SuiteQL), schema probe, permission resolver, the one write module
src/shared      constants (one copy for both sides) and the rules engine (pure functions)
src/client      client entry (stub until the engine tie-out is signed off)
test            rule tests, server tests, golden tie-out, fixtures
tools           build, deploy, snapshot, probe, golden, overlap delta, CSP experiment
docs            write-ups and checklists
```
