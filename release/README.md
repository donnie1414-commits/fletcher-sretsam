# Built files for upload

These are the exact outputs of `npm run build` for the commit that ships them. `MANIFEST.json` carries each file's SHA-256 and byte size. Upload steps: `docs/DEPLOY.md`.

| File | Goes where |
|---|---|
| `amicus_leasing_sl.js` | the Suitelet script record (the only file that goes on a script record) |
| `amicus_leasing_app.js` | File Cabinet only; its internal id goes in script parameter `custscript_al_client_js` |
| `amicus_leasing_app.css` | File Cabinet only; its internal id goes in `custscript_al_client_css` |

Rebuild and refresh this folder with `npm run build && cp dist/amicus_leasing_* dist/MANIFEST.json release/`.
