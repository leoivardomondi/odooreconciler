# Odoo Reconciler

Production-ready Node.js + TypeScript web app for connecting to any Odoo 19 instance, searching Sales Orders, detecting Job Summary PDFs, extracting the `Edging Materials` section, writing structured results back into configurable Odoo custom fields, and reconciling unused edge banding stock back into inventory.

## What it does

- Connects to any Odoo 19 instance using the External JSON-2 API.
- Stores Odoo connection details in the configured app database with API key encryption at rest.
- Tests Odoo connectivity from the UI.
- Searches and views Sales Orders.
- Lists Sales Order attachments and highlights Job Summary PDFs.
- Downloads real PDF attachments from Odoo and parses them with `pdf-parse`.
- Extracts structured `Edging Materials` items into JSON.
- Displays parsed results visually and as pretty JSON.
- Sends extracted data back to configurable `sale.order` fields in Odoo.
- Exposes a token-protected webhook so Odoo can trigger processing immediately after PDF upload.
- Reconciles unused edge banding stock with the formula `Sales Order ordered metres - Job Summary used metres`.
- Adds only the unused quantity back into stock at the configured location.
- Uses PDF signatures plus per-item tracking to prevent duplicate stock returns.
- Supports reversal of app-recorded stock additions.
- Computes a SHA-256 signature from the raw Job Summary PDF bytes.
- Compares the computed signature with the stored Odoo signature to detect unchanged PDFs.
- Supports skip-by-default duplicate protection with an optional force-send override.
- Keeps logs, extraction history, and stored results in the configured app database.
- Includes a Passenger entrypoint for cPanel Node.js Application Manager deployments.

## Stack

- Backend: Node.js, TypeScript, Express, Axios, `mysql2`, pdf-parse, dotenv, uuid
- Frontend: EJS, Bootstrap 5, Vanilla JS
- Storage: MySQL

## Project structure

```text
.
├─ app.ts
├─ server.ts
├─ passenger.js
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ README.md
├─ storage/
└─ src/
   ├─ models/
   ├─ public/
   ├─ routes/
   ├─ services/
   ├─ types/
   ├─ utils/
   └─ views/
```

## Requirements

- Node.js 20.20.0+
- An Odoo 19 instance with:
  - External JSON-2 API access
  - A user account that can read `sale.order`, `ir.attachment`, and write to the target custom fields
  - An API key for that user
- Writable filesystem for `storage/`

## Environment setup

1. Copy `.env.example` to `.env`.
2. Set the MySQL database credentials from cPanel.
3. Set strong `APP_ENCRYPTION_KEY` and `APP_SESSION_SECRET` values.

Production MySQL example:

```env
PORT=3000
NODE_ENV=production
APP_BASE_URL=
DB_CLIENT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=your_cpanel_database
DB_USER=your_cpanel_user
DB_PASSWORD=your_cpanel_password
APP_ENCRYPTION_KEY=use-a-long-random-secret-value-here
APP_SESSION_SECRET=use-another-long-random-secret-value-here
ODOO_WEBHOOK_TOKEN=use-a-long-random-webhook-secret-here
TRUST_PROXY=true
```

## Connect Gemini with Google OAuth

Gemini can use a Google OAuth connection instead of a Gemini API key. The server stores the refresh token inside the existing encrypted AI credential payload and refreshes access tokens for scheduled jobs.

1. In Google Cloud, enable the Generative Language API and configure the OAuth consent screen. Add the Google account that will authorize the scheduler as a test user while the consent screen is in testing.
2. Create an OAuth 2.0 **Web application** client. Add this exact redirect URI, using the deployed `APP_BASE_URL`:
   `https://your-host.example/settings/ai/gemini/callback`
3. Ensure the deployed `APP_BASE_URL` is set so the callback URL is stable:

```env
APP_BASE_URL=https://your-host.example
```

4. Open Settings → AI Parser and enter the Google Cloud project ID, OAuth client ID, and OAuth client secret. Click Save AI, then click Connect with Google and approve the Gemini scope.
5. Select Google Gemini as the AI provider and use Test selected AI connection. The test uses the OAuth connection when it is connected; the API-key field remains available as a fallback after disconnecting OAuth.

See Google’s [Gemini OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth) for the current Cloud project, API, consent-screen, and OAuth prerequisites.

## Install and run locally

```bash
npm install
npm run build
npm run start
```

For local development with auto-reload:

```bash
npm run dev
```

The app will be available at `http://localhost:3000` unless you changed `PORT`.

## First-time app workflow

1. Open `/setup`.
2. Enter:
   - Odoo Base URL
   - Database name if your Odoo host requires it
   - Username
   - API Key
3. Click `Test Connection`.
4. Save the setup.
5. Open `Sales Orders`.
6. Search for a Sales Order and open it.
7. Review attachments.
8. Click `Extract Latest Job Summary` or `Extract Selected`.
9. Review the parsed JSON on the extraction page.
10. Click `Compare Signature` to see whether the PDF matches the signature stored in Odoo.
11. Click `Send to Odoo`, or `Force Send Anyway` if the signature matches and you still want to overwrite Odoo.

## Instant Odoo upload webhook

Cron polling is still supported, but Odoo can also notify the app immediately when a Sales Order PDF is uploaded.

Set the shared secret in this app:

```env
ODOO_WEBHOOK_TOKEN=MY_SHARED_SECRET
```

Use this Odoo webhook URL:

```text
https://domain.com/jobs/attachment-uploaded?token=MY_SHARED_SECRET
```

Odoo Automated Action setup:

- Model: `ir.attachment`
- Trigger: On Creation
- Action: Send Webhook Notification
- URL: `https://domain.com/jobs/attachment-uploaded?token=MY_SHARED_SECRET`
- Fields to include:
  - `id`
  - `res_id`
  - `name`
  - `res_model`
  - `mimetype`

Odoo's built-in webhook payload should look like this:

```json
{
  "_action": "Send Webhook Notification(#NewId_0x766e17e27d00)",
  "_id": 8331,
  "_model": "ir.attachment",
  "id": 8331,
  "mimetype": "application/pdf",
  "name": "Job Summary.pdf",
  "res_id": 567,
  "res_model": "sale.order"
}
```

The webhook also still accepts the custom payload format and Bearer-token authentication:

```json
{
  "attachment_id": 8331,
  "order_id": 567,
  "filename": "Job Summary.pdf",
  "res_model": "sale.order",
  "mimetype": "application/pdf"
}
```

Behavior:

- The app accepts the shared token from `?token=...`, `Authorization: Bearer ...`, or webhook token headers.
- The app maps Odoo fields as `id -> attachment_id`, `res_id -> order_id`, `name -> filename`, `res_model -> linked model`, and `mimetype -> MIME type`.
- If a PDF is uploaded through a Sales Order chatter/log note and Odoo reports `res_model` as `mail.message`, the app resolves that message back to its `sale.order` before processing.
- The app verifies the payload shape, Sales Order attachment relationship, PDF type, and configured Job Summary filename keyword.
- Non-Sales Order payloads, non-PDF files, and non-matching filenames return JSON with `status: "ignored"`.
- Matching PDFs reuse the existing extraction flow and then call the existing send-to-Odoo flow.
- Manual extraction and scheduler behavior are unchanged.

## Odoo API notes

This app uses the Odoo 19 External JSON-2 API shape:

- Base path: `/json/2/<model>/<method>`
- Authorization: `Authorization: bearer <api-key>`
- Optional database header: `X-Odoo-Database: <db-name>`

The implementation lives in [src/services/odooClient.ts](src/services/odooClient.ts).

Implemented methods:

- `testConnection()`
- `searchSalesOrders()`
- `getSaleOrder()`
- `getAttachments(orderId)`
- `downloadAttachment(attachmentId)`
- `getSaleOrderFields()`
- `readSaleOrderFields(orderId, fieldNames)`
- `updateSaleOrder(orderId, data)`
- `safeUpdateSaleOrder(orderId, payload, availableFields?)`
- `postChatterMessage(orderId, message)`

## PDF parsing behavior

The parser targets the `Edging Materials` section only.

Default behavior:

- Finds the configured section header
- Detects product lines with the configurable regex
- Extracts:
  - `color`
  - `thickness_mm`
  - `length_mm`
  - `roll_length_mm`
- Handles multiple items
- Ignores non-PDF attachments
- Supports configurable stop headers for messy PDFs

All parser rules are editable from the UI on `/settings`.

## Usage-based stock reconciliation

This app uses Job Summary edging usage to reconcile unused stock. It is not a "PDF delta" workflow.

Formula per edging color:

1. Read `length_mm` from the extracted Job Summary JSON.
2. Convert to used metres with `Math.round(length_mm / 1000)`.
3. Match the Sales Order service line `Edge Banding Service <Color>`.
4. Read `product_uom_qty` from that Sales Order line as ordered metres.
5. Compute `unused quantity to add = ordered metres - used metres`.
6. If the result is positive, add only that amount back into stock.
7. If the result is zero or negative, skip and log the reason.

Important notes:

- The extracted Job Summary JSON contains actual used lengths, not differences between PDFs.
- The Odoo field `x_studio_job_summary_delta_json` may still be used technically, but in this app it is treated as Stock Adjustment Input JSON for stock reconciliation.
- Stock writes are additive. The app reads current stock, computes `newStock = currentStock + unusedQuantityToAdd`, and applies that target quantity through Odoo inventory adjustment.
- The app does not recount stock, overwrite stock to the used amount, or use the extracted Job Summary quantity as the quantity to add.
- Manufacturing Order gating, BOM company filtering, component variant resolution, preview mode, reversal, and scheduler compatibility are preserved.

## Stock reconciliation idempotency

Duplicate stock returns are prevented in two ways:

1. Order-level signature protection checks whether the current Job Summary signature already matches the stored stock reconciliation signature.
2. Per-item tracking stores successful app-recorded additions by Sales Order, PDF signature, and stock variant until they are reversed.

Because of that:

- The same Job Summary cannot add stock twice unless the prior app-recorded addition was reversed.
- Reversal subtracts only the stock additions recorded by this app and clears the stock reconciliation proof fields so the order can be processed again if appropriate.

## Database tables

- `settings`
- `logs`
- `history`
- `extracted_results`
- `odoo_model_fields_cache`

The database is created automatically on startup.

## Security model

- API keys are never rendered back into the HTML UI.
- API keys are encrypted before being stored in the database.
- Logs sanitize sensitive fields such as API keys, tokens, and attachment binary payloads.
- Field names and parser rules are editable from the UI, not hardcoded in routes or templates.

## Signature-based duplicate detection

Each extracted Job Summary PDF gets a deterministic SHA-256 signature computed from the raw PDF binary, not from the filename or attachment ID.

Flow:

1. The app downloads the PDF from Odoo.
2. It computes a hex SHA-256 signature.
3. It reads the configured Odoo signature field on `sale.order`.
4. It compares:
   - `match`: the PDF appears unchanged
   - `different`: the PDF changed
   - `missing`: no signature is stored in Odoo yet
5. Default behavior:
   - if signatures match, the app warns and skips the send
   - if signatures differ or Odoo has no stored signature, the app allows a normal send
6. If you still want to overwrite Odoo when signatures match, use `Force Send Anyway`.
7. After a successful send, the app writes the new signature back to Odoo.

The signature field expected in Odoo is:

- `x_studio_job_summary_signature`

## Configurable Odoo target fields

The Settings page lets you edit field mappings such as:

- `x_studio_job_summary_edge_json`
- `x_studio_job_summary_processed`
- `x_studio_job_summary_last_processed_on`
- `x_studio_job_summary_processing_log`
- `x_studio_last_job_summary_filename`
- `x_studio_last_job_summary_attachment_id_1`
- `x_studio_previous_job_summary_json`
- `x_studio_job_summary_signature`
- `x_studio_job_summary_stock_signature`
- `x_studio_job_summary_delta_json` as stock adjustment input JSON

Before writing back to Odoo, the app checks that configured field names exist on `sale.order`.

## cPanel deployment

### Files included for cPanel

- `passenger.js`: Passenger-compatible startup entrypoint
- `server.ts`: main HTTP server bootstrap
- `app.ts`: Express app setup

### Deployment steps

1. Upload the full project to your cPanel application directory.
2. In cPanel `Node.js Application Manager`, create or edit the Node app.
3. Set:
   - Node.js version: `20.20.0`
   - Application mode: `Production`
   - Application root: your uploaded project directory
   - Startup file: `server.js` or `passenger.js`
4. Build the app locally before upload so `dist/` is already present.

```bash
npm.cmd run build
```

5. After upload, use cPanel's `Run NPM Install` or `Install Dependencies` button if your host provides it.

6. Configure environment variables in cPanel:
   - `NODE_ENV=production`
   - `DB_CLIENT=mysql`
   - `DB_HOST=<mysql-host>`
   - `DB_PORT=3306`
   - `DB_NAME=<mysql-database-name>`
   - `DB_USER=<mysql-username>`
   - `DB_PASSWORD=<mysql-password>`
   - `APP_ENCRYPTION_KEY=<strong-random-secret>`
   - `APP_SESSION_SECRET=<second-strong-random-secret>`
   - `REQUEST_TIMEOUT_MS=20000`
   - `STARTUP_STEP_TIMEOUT_MS=30000`
   - `DB_INIT_TIMEOUT_MS=30000`
   - `TRUST_PROXY=true` if your host is behind a reverse proxy
7. Restart the Node application from cPanel.

For production MySQL on cPanel, `DB_CLIENT=mysql` must be set explicitly. The app also accepts the legacy aliases `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`, but the preferred cPanel names are `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.

### Important cPanel note

The app serves templates and static assets directly from `src/views` and `src/public`, so keep the `src` directory deployed alongside the compiled `dist` output. Path resolution is now project-root based, so Passenger does not depend on `process.cwd()` for views, static files, `.env`, or storage paths. The root `server.js` file is a compatibility shim for hosts that insist on that startup filename.

### cPanel without terminal

If you do not have terminal access, this project is designed to work with:

1. local build
2. upload of the prebuilt `dist/` folder
3. cPanel `Run NPM Install` or `Install Dependencies`
4. app restart

Required upload items:

- `dist/`
- `src/views/`
- `src/public/`
- `storage/`
- `package.json`
- `package-lock.json`
- `server.js`
- `passenger.js`
- `.env`

If `dist/server.js` is missing, the Passenger startup log will now tell you that the built `dist/` folder was not uploaded.

### Startup and database failures

Startup status is exposed through `/health`. If database initialization fails or exceeds `DB_INIT_TIMEOUT_MS`, normal pages return a clear startup failure response instead of remaining in `starting` indefinitely.

Check `storage/startup.log` and the Passenger/cPanel app log for the exact database error. Common production MySQL causes are:

- `DB_CLIENT` is not set to `mysql`
- `DB_HOST`, `DB_NAME`, `DB_USER`, or `DB_PASSWORD` is missing or incorrect
- the MySQL user does not have permissions to create or alter tables
- cPanel requires `localhost` instead of `127.0.0.1`, or vice versa
- the database name/user is missing the cPanel account prefix

## Production checklist

- Set a strong `APP_ENCRYPTION_KEY`
- Confirm Odoo user permissions for:
  - `sale.order`
  - `ir.attachment`
  - `ir.model.fields`
  - chatter posting on `sale.order`
- Confirm the target custom fields exist on `sale.order`
- Confirm the Odoo API key is active
- Back up the MySQL database if history retention matters

## Troubleshooting

### Connection test fails

- Verify the base URL is correct
- Verify the API key is valid
- Confirm the Odoo instance supports External JSON-2 API access
- If needed, fill the database name so the app can send `X-Odoo-Database`

### No Job Summary PDF found

- Confirm the attachment is a PDF
- Confirm the filename includes the configured keyword from Settings
- Use `Extract Selected` to try a specific PDF manually

### No items extracted

- Open the extraction page and inspect parser logs
- Adjust:
  - section header
  - product line regex
  - label names
  - stop headers

### Odoo update fails

- Confirm the configured field names exist on `sale.order`
- Confirm the current Odoo user can write those fields
- Check the extraction logs and dashboard logs for the returned API error

### Signature says the PDF is unchanged

- The app compares the SHA-256 of the current PDF against the signature stored in Odoo
- Use `Compare Signature` on the extraction page to refresh the comparison
- Use `Force Send Anyway` if you intentionally want to resend the same PDF

## Useful scripts

```bash
npm run dev
npm run build
npm run start
npm run check
```
