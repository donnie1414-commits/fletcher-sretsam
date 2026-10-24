# Uploading the workspace to NetSuite

Three files, one Suitelet script record, one deployment, two script parameters. About fifteen minutes the first time; later updates are a re-upload of up to three files and nothing else.

The files are in the hand-back:

| File | What it is | Size (bytes) | SHA-256 (first 12) |
|---|---|---|---|
| `amicus_leasing_sl.js` | the Suitelet (server). Starts `/** @NApiVersion 2.1 @NScriptType Suitelet` | 198,676 | `c049be00a056` |
| `amicus_leasing_app.js` | the client bundle. One minified line starting `(()=>{` | 174,600 | `8330f00285ef` |
| `amicus_leasing_app.css` | the stylesheet. Starts `:root{` | 23,348 | `968da194034c` |

`MANIFEST.json` carries the full hashes. Sizes are the quick check after upload: File Cabinet shows the byte size on each file.

**Only `amicus_leasing_sl.js` ever goes on a Script record.** The other two are plain files the Suitelet links to by internal id.

## 1. Upload the three files (File Cabinet)

1. Documents › Files › File Cabinet. Open **SuiteScripts**. Click **New Folder**, name it `AmicusLeasing`, save.
2. Inside the folder click **Add File** and upload `amicus_leasing_app.js`. Leave *Available Without Login* unchecked. Save.
3. Repeat for `amicus_leasing_app.css` and `amicus_leasing_sl.js`.
4. Open each uploaded file and note its **Internal ID** (it is in the URL as `id=` and in the file's record). You need the ids of the `.js` client bundle and the `.css`.

If the account blocks `.js` uploads through Add File, use Documents › Files › **Upload File** (the advanced uploader), or upload a `.zip` of the three files and choose *Unzip*.

## 2. Create the Suitelet script record

1. Customization › Scripting › Scripts › **New**.
2. Pick **Select File** › the `amicus_leasing_sl.js` you just uploaded (internal id **229897** as of 2026-10-24). Click **Create Script Record**. NetSuite reads the `@NScriptType Suitelet` header and opens the Suitelet form.
3. Fill in: Name `Amicus Leasing Workspace`; ID `_al_leasing_workspace` (NetSuite prefixes `customscript`).
4. **Parameters** subtab › New Parameter, five times. Type the ID starting at the underscore; NetSuite adds `custscript`.

| ID to type | Label | Type | Notes |
|---|---|---|---|
| `_al_client_js` | Client bundle file id | Integer Number | the `.js` file id from step 1 (uploaded 2026-10-24: **229898**) |
| `_al_client_css` | Client styles file id | Integer Number | the `.css` file id from step 1 (uploaded 2026-10-24: **229899**) |
| `_al_overlap_rule` | Overlap rule (§5.7.1) | Check Box | leave **off** until OVERLAP-DELTA.md is signed off |
| `_lkr_markets` | Markets | Free-Form Text | same meaning as on the old report: comma-separated market names, blank = no narrowing |
| `_lkr_user_lock` | Lock viewers to their markets | Check Box | **on**. Off means everyone sees every market |

   If `custscript_lkr_markets` and `custscript_lkr_user_lock` already exist in the account from the v2 Suitelet, reuse them by typing the same ids; NetSuite will tell you if an id is taken by another script, in which case create them fresh on this script.

5. Save the script record.

## 3. Deploy it

1. On the script record click **Deploy Script** (or Deployments subtab › New Deployment).
2. Title `Amicus Leasing Workspace`; ID `_al_leasing_workspace`.
3. **Status: Testing** for the first open (only you can run it), **Deployed** once it works.
4. **Audience** subtab: tick the leasing roles (and Administrator). Nothing else needs ticking.
5. **Parameters** subtab: enter the two file ids, tick the user lock, leave the overlap rule unticked, fill the markets text only if you want this deployment narrowed.
6. Save. The deployment's **URL** field is the link people open. Bookmark it or add it to the Centers & Tabs menu the old report used.

## 4. First open: what you should see

Open the deployment URL.

- A page that reads **Loading Amicus Leasing…** for under a second, then the Today screen with your scope in the header. Done.
- **"Client bundle not configured"**: one or both file-id parameters are empty or point at the wrong file. Check step 3.5.
- **Blank white page**: open the browser console (F12). If it reports a Content-Security-Policy block on the `.js` file, the account does not allow Suitelets to load scripts from the File Cabinet. Upload the two files in `tools/csp-probe/` from the source archive as a second Suitelet, open it once, and send me the line it prints; the fallback is a one-line change that serves the bundle through the Suitelet itself.
- **"You have no market access"**: the user lock is on and your employee record's market field is blank. Fill the field or untick the lock while testing.
- A grey banner **"Some fields are not created yet, so these features are off: …"**: expected until the optional fields in SETUP-CHECKLIST.md are created. Each named feature is simply off; nothing else is affected.

## 5. Role permissions

The Suitelet runs as the signed-in user. The leasing roles need:

- **View** on Property, Units/Bedrooms, Lease Record, Academic Year, Academic Year Details, Unit Leasing Status, Unit Leasing Note, Customer, Subsidiary.
- **Edit** on Unit Leasing Status, Unit Leasing Note, Lease Record and Customer for the pipeline edits, notes, lease creation and tenant assignment. Create on Unit Leasing Status and Unit Leasing Note.
- The "Lease records made inactive this week" section needs *System Notes* visibility on the role; without it the section says so and the rest of the page is unaffected.

## 6. Updating later

Re-upload, never re-create: open the existing file in the File Cabinet and use **Edit › Select File** to replace its content. The internal id does not change, so the script parameters keep working and nothing on the script record is touched. Compare the byte size with the new `MANIFEST.json` afterwards.

From the repo, `npm run deploy` does the same three uploads with a SHA-256 check and refuses to put the client bundle on the Suitelet slot. It needs a `deploy.map.json` with the three internal ids (the command prints the template) and read-write File Cabinet credentials; it is a dry run unless given `--yes`.

## 7. Optional, after it runs

`docs/SETUP-CHECKLIST.md` lists the list value, fields and two custom records that switch on the remaining features (lease-terms shadow on the status row, tour link, saved views stored in NetSuite, the write-audit record). Each is independent; the app reports which are missing in the header banner.
