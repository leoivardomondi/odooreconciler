# Project Rules & Workspace Context: Odoo Reconciler

## Project Overview
- **Repository / Corpus**: `leoivardomondi/odooreconciler`
- **Application**: Odoo Job Summary PDF Extractor & Financial Reconciler
- **Stack**: Node.js (>= 20.20), TypeScript (`tsc` / `tsx`), Express.js, EJS, SQLite / MySQL, PDF Extraction & OCR (`pdf-parse`, `tesseract.js`, `@google-cloud/vision`), Odoo 19 integration.

## Key Entry Points & Structure
- **Main Server**: [server.ts](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/server.ts)
- **App Configuration**: [app.ts](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/app.ts)
- **Services & Logic**: [src/services/](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/src/services/)
  - E.g. [schedulerFailureAnalysisService.ts](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/src/services/schedulerFailureAnalysisService.ts)

## Workflow & Development Rules
- **Type Checking**: Run `npm run check` (`tsc --noEmit -p tsconfig.json`) to verify type safety.
- **Dev Server**: Run `npm run dev` (`tsx watch server.ts`) when testing backend services locally.
- **Context Persistence**: Store critical project decisions, database schema updates, and key business logic in this file (`.agents/AGENTS.md`) so future agent chats in this workspace retain full context.

## Key Business Logic & Decisions
- **PO Bill Automation**:
  - Automatically posts (`action_post` on `account.move`) vendor bills created via `createVendorBillFromPurchaseOrders` to move them to `posted` state and update the Purchase Order `invoice_status` to `invoiced`.
  - Automatically registers payment on confirmed vendor bills:
    - If PIN status is `NO PIN`, registers payment from the **MPESA** journal.
    - If PIN status is `ETR`, registers payment from the **001215001007459** journal.
    - The payment date strictly matches the vendor bill / invoice date (`invoice_date` from vendor).
  - Skips creating redundant "Review PO bill automation" activities on POs that already have a matched vendor bill attached.
  - **PO Bill Scheduler Rate-Limiting Protections**:
    - **Bulk PO Line Queries (Anti-N+1)**: Candidate PO lines are loaded via `getBulkPurchaseOrderLines` (`['order_id', 'in', candidateIds]`) in a single Odoo RPC query rather than making individual per-order network calls.
    - **Candidate Pre-Scoring**: Orders are pre-scored on vendor, amount, and date before line inspection; only viable candidate orders (top 20 max) fetch lines. Orders with mismatched vendors or 0 preliminary score skip line fetching completely.
    - **Single-Pass Candidate Matching**: When `onlyUnbilledPurchaseOrders` is active, a single broad search pass is performed and unbilled eligible candidates are derived in memory, cutting candidate search queries in half.
    - **In-Memory Static Caching**: Schema fields (`ir.model.fields`), document tags (`documents.tag` for Validated and Delivery Note), payment journals (`account.journal` for MPESA and Bank), and vendor partner IDs (`res.partner` with 15m TTL) are cached in memory to eliminate repeated static Odoo round-trips.

- **Zero-Blocking UI & Navigation Architecture**:
  - **No Blocking Overlays on Navigation**: Never display full-screen blocking overlays (`.app-loading-overlay`) during page navigation or data browsing. A non-blocking top progress bar (`#topNavProgressBar`) provides smooth visual progress while keeping the current page interactive and responsive.
  - **Non-Wiping Instant Navigation**: `beginInstantNavigation` preserves existing page content without clearing `<main>` to a loading skeleton.
  - **SWR with Zero-Wait Serving**: All shop floor routes (`/shop-floor`, `/shop-floor/boards`, `/shop-floor/receipts`, `/shop-floor/deliveries`, `/shop-floor/operators`) and `/settings` serve from in-memory RAM cache or MySQL persistent snapshot immediately (<25ms). If `refresh=true` or data is stale, the response is served instantly while revalidation runs in the background.
  - **Max Page Wait Cap**: For cold misses with no prior snapshot, route handlers wrap external Odoo queries with `withMaxPageWait` (capped at 1200ms) and return a clean fallback shell if Odoo is slow, allowing background workers to populate the persistent cache without stalling the user.
  - **PWA Badge Counter Decoupling**: `/notifications/due-tasks-count` reads stock alerts directly from local MySQL snapshots (`getShopFloorDashboardSnapshot`) and review counts from local DB instead of making synchronous Odoo XML-RPC queries, keeping Odoo rate-limiting queues completely unblocked.
  - **Instant Operator Login from MySQL**: When operators log in, `/shop-floor` immediately serves all active work orders, stock alerts, and pending tasks directly from MySQL tables (`shop_floor_shared_cache`, `shop_floor_pending_processes`, and `shop_floor_dashboard_snapshots`) in <10ms via `buildInstantMysqlOperatorDashboard`. It never blocks on Odoo XML-RPC or renders an empty shell. In-flight revalidation happens asynchronously in the background.
  - **Decoupled Task Notifications**: `/notifications/shop-floor-tasks` for app requests reads pending board intake tasks from `shop_floor_pending_processes` and open deliveries/receipts from `shop_floor_shared_cache`, executing in ~5ms without synchronous Odoo round-trips.
  - **Customer Mirror & Instant Intake**: All active customers are mirrored in MySQL table `customer_partner_mirror`. Search and dropdown autocomplete pull directly from MySQL (<2ms). Board intake form submission returns immediately without full-page loading locks, and clears all fields ready for the next entry.
  - **Continuous Background Sync**: Background workers `startCustomerMirrorInterval` and `startShopFloorPendingSyncInterval` periodically synchronize customer partners and active MO board requirements from Odoo into MySQL.
  - **Strict Target Company Isolation (`URBAN VIBE 2` Exclusion)**: The application strictly operates for company **URBAN VIBE INTERIOR DESIGN COMPANY LTD** (Odoo Company ID 1, Warehouse prefix `WH/MO/`). Company **URBAN VIBE 2** (Odoo Company ID 3, partner ID 350, warehouse prefix `VA/WH/MO/` or `VA/`) is **strictly and permanently excluded** across all models (`mrp.production`, `sale.order`, `purchase.order`, `res.partner`, `stock.picking`), background sync services (`shopFloorPendingSyncService`, `customerMirrorService`), customer autocomplete search, route handlers, and MySQL tables (`shop_floor_pending_processes`, `customer_partner_mirror`).

- **Unified Weekly Report Pipeline (Download & Email Parity Rule)**:
  - The weekly shop floor accountability report PDF format, date calculation window, overtime records, operator reminders, and styling MUST be 100% identical between downloaded reports and automated email reports.
  - Both `/shop-floor/operators/weekly-report.pdf` (download) and `sendWeeklyShopFloorReport` (automated cron / manual email send) strictly consume `getOrBuildWeeklyShopFloorReportPdf()` from the shared MySQL snapshot (`shop_floor_shared_cache`), guaranteeing full parity, instant (<50ms) delivery, and zero drift between download and email outputs.
  - The report is scheduled for delivery at **7:00 AM Nairobi time** on Wednesdays via `emailAutomationService`. `sendWeeklyShopFloorReport()` passes `{ forceRefresh: true }` to guarantee live data and ensure only the modern format (overtime records, worked hours, missing checkouts, attendance rates, and 2-page unified layout) is ever emailed. Duplicate background runner loops in `server.ts` are deprecated in favor of warmup pre-caching.
  - **7:00 AM Email Exclusivity & Anti-Duplication**: On Wednesday at 7:00 AM Nairobi time, ONLY the weekly report is permitted to dispatch. All other automated emails (hourly reminders, daily notifications, custom emails) are strictly suppressed during the 7:00 AM window. Hourly task reminders only execute during factory operator shift hours (8:00 AM to 5:00 PM), never at 7:00 AM or on Sunday. Date-keyed verification guarantees that the weekly report can never dispatch more than once on any Wednesday.

