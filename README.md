# Vinted Inventory Manager - GitHub + Supabase port

This folder is a GitHub-ready migration scaffold for the Apps Script project in `../handoff/vinted-codex-handoff`.

## What changed

- Google Apps Script server functions are replaced by `src/server.js`.
- The existing browser UI is served from `public/`.
- `public/bridge.js` keeps the old `google.script.run` call style working by proxying calls to `/api/rpc/:method`.
- Google Sheet tabs become Supabase tables.
- Google Drive picture/label uploads become Supabase Storage uploads.
- A QR/barcode scanner panel has been added to the Actions tab.

## Setup

1. Create a new Supabase project.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - optional `OPENAI_API_KEY`
4. Install and run locally:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Default login after running the schema:

- username: `admin`
- password: `changeme`

## Migrating sheet data

Export each Google Sheet tab as CSV and put the files into `data-import/`.

In Google Sheets:

1. Open the source spreadsheet.
2. Click a tab such as `Inventory`.
3. Use `File` -> `Download` -> `Comma-separated values (.csv)`.
4. Rename the downloaded file to match the tab name exactly, for example `Inventory.csv`.
5. Repeat for the tabs you want to migrate.

Expected CSV filenames:

- `Inventory` -> `inventory`
- `Pictures` -> `pictures`
- `Labels` -> `labels`
- `AuditLog` -> `audit_log`
- `StatusLog` -> `status_log`
- `Settings` -> `settings`
- `Logins` -> `logins`
- `Sales` -> `sales`

Then run:

```bash
npm run import-csv
```

The importer maps the sheet headers to Supabase columns. For example, `Item ID` becomes `item_id`, and `Target Sale Price` becomes `target_sale_price`.

## Changing the default login

After schema setup, replace the default `admin` / `changeme` login:

```bash
npm run set-admin
```

The script asks for an admin email, username, and password. It stores the password as a bcrypt hash in Supabase.

## Scanner behaviour

The Actions tab now supports camera scanning when the browser exposes the `BarcodeDetector` API. It accepts QR codes and common barcodes. If a scanned QR contains a URL, the app looks for `itemId`, `item_id`, or `barcode` query parameters before falling back to the last URL path segment. If live scanning is not supported, paste the QR/barcode value into the manual lookup field.

## GitHub Pages deployment

This repo can deploy the static app in `public/` to GitHub Pages.

In Supabase SQL Editor, run:

```sql
-- paste supabase/github-pages-policies.sql
```

In GitHub, add:

- Repository variable `SUPABASE_URL`
- Repository variable `SUPABASE_PUBLIC_URL`
- Repository secret `SUPABASE_ANON_KEY`

Then go to `Settings` -> `Pages` and set the source to `GitHub Actions`.
Push to `main`; the `Deploy GitHub Pages` workflow will publish the app.

For local static testing, copy `public/config.example.js` to `public/config.js` and fill in the same public Supabase values. Do not put the service-role key in `public/config.js`.

## Still to decide

- Email alerts, packing-list PDF generation, and AI descriptions need a backend function and are not available on GitHub Pages yet.
- The GitHub Pages policy file is permissive for a personal app. Supabase Auth policies are the right next step before sharing the site widely.
