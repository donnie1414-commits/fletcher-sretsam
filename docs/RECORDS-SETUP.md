# Creating the two hub records in NetSuite

Two custom record types the Leasing Hub writes to. Nobody enters data in them by hand; the hub fills them in. About ten minutes each, as Administrator. Create the record type first, then its fields from the same screen.

Type the IDs exactly as shown, starting with the underscore. NetSuite adds the `customrecord` / `custrecord` prefix itself.

---

## Record 1 — Write Audit (do this one first)

What it is: a log of every change the hub makes (who, when, which record, old value, new value). It also stops a double-click from applying the same change twice.

**Create the record type**

1. Customization › Lists, Records & Fields › Record Types › **New**.
2. Name: `AD Write Audit`. ID: `_ad_write_audit`.
3. Tick **Include Name Field** off (untick it). Leave everything else as default. Under **Permissions** choose *Use Permission List*, then on the Permissions subtab add each leasing role with level **Create** (Administrator already has access). The hub creates rows; nobody edits them.
4. **Save**.

**Add the fields** (on the saved record type, Fields subtab › **New Field**, one at a time; Save after each)

| Label | ID to type | Type | Settings |
|---|---|---|---|
| Who | `_ad_wa_who` | List/Record | List/Record: **Employee** |
| When | `_ad_wa_when` | Date/Time | |
| Record type | `_ad_wa_rectype` | Free-Form Text | |
| Record id | `_ad_wa_recid` | Free-Form Text | |
| Field | `_ad_wa_field` | Free-Form Text | |
| Before | `_ad_wa_before` | Long Text | |
| After | `_ad_wa_after` | Long Text | |
| Change id | `_ad_wa_change_id` | Free-Form Text | Validation & Defaulting subtab: tick **Unique** |

The last one, Change id, is the important setting: *Unique* is what prevents a change being written twice.

---

## Record 2 — Saved Views

What it is: where the **Save view** button on the Pipeline and People screens stores a person's saved filters, so they follow the person between computers and can be shared within a market. Without it the button still works but saves only in that browser.

**Create the record type**

1. Customization › Lists, Records & Fields › Record Types › **New**.
2. Name: `AD Saved View`. ID: `_ad_saved_view`.
3. Leave **Include Name Field** ticked. Under **Permissions** choose *Use Permission List* and add each leasing role with level **Edit** (people edit their own saved views).
4. **Save**.

**Add the fields**

| Label | ID to type | Type | Settings |
|---|---|---|---|
| Owner | `_ad_sv_owner` | List/Record | List/Record: **Employee** |
| Workspace | `_ad_sv_workspace` | Free-Form Text | |
| View name | `_ad_sv_name` | Free-Form Text | |
| State | `_ad_sv_json` | Long Text | |
| Default | `_ad_sv_default` | Check Box | |
| Shared with markets | `_ad_sv_shared_markets` | Free-Form Text | |

---

## Check it worked

Open the Leasing Hub and reload with Ctrl+Shift+R. The grey banner at the top lists any feature that is still off. After both records exist, the Pipeline's save bar stops saying "audit: log-only", and Save view stores to NetSuite.

If a field ID is mistyped the hub does not fail; it reports that feature as off in the banner, and you can rename the field.
