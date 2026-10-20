# Project Rules & Workspace Context: Odoo Reconciler

## Project Overview
- **Repository / Corpus**: `leoivardomondi/odooreconciler`
- **Application**: Odoo Job Summary PDF Extractor & Financial Reconciler
- **Hosted Production URL**: `https://app.urbanvibeinteriordesign.co.ke/`
- **Stack**: Node.js (>= 20.20), TypeScript (`tsc` / `tsx`), Express.js, EJS, SQLite / MySQL, PDF Extraction & OCR (`pdf-parse`, `tesseract.js`, `@google-cloud/vision`), Odoo 19 integration.

## Key Entry Points & Structure
- **Main Server**: [server.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/server.ts)
- **App Configuration**: [app.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/app.ts)
- **Services & Logic**: [src/services/](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/)
  - E.g. [schedulerFailureAnalysisService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/schedulerFailureAnalysisService.ts)

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

- **Non-Blocking Asynchronous FIFO Receipt & Delivery Validation Queue**:
  - Validating stock receipts or delivery orders (`/shop-floor/receipts/:id/validate`, `/shop-floor/deliveries/:id/validate`) never displays full-screen loading locks.
  - The UI responds instantly (<10ms) by enqueuing a validation job into `shop_floor_validation_jobs`.
  - Background worker `shopFloorValidationJobService` processes validation jobs sequentially in strict FIFO order (`ORDER BY created_at ASC`), running Odoo XML-RPC validation safely in the background.
  - The UI card dynamically displays "In Queue" -> "Validating..." -> "Validated" via lightweight polling on `/shop-floor/validation-jobs/status`, freeing the operator to continue browsing or queueing subsequent receipts immediately.

- **Strict Manufacturing Order (MO) Stock Availability Enforcement (Start & Close)**:
  - **Zero Unreserved Operations Rule**: No Manufacturing Order (MO) or Work Order (WO) may be started, finished, or closed unless 100% of required raw materials/components (`move_raw_ids`) have been physically received and assigned in stock (`state in ('assigned', 'done')` and `quantity >= product_uom_qty`).
  - **In-App Enforcement**:
    - `OdooClient.checkManufacturingOrderStockAvailability(moId)`: Checks all component moves on an MO; runs `action_assign` to allocate newly received inventory; returns exact missing products, quantities, and flags for missing boards vs hardware.
    - `POST /shop-floor/work-order/:id/advance` and `OdooClient.advanceManufacturingOrder`: Strictly block both `action === 'start'` and `action === 'finish'` if any component is missing, returning `HTTP 409` (`code: 'stock_missing'`).
    - UI (`src/views/shop-floor.ejs`): Replaces generic modal alerts with a structured missing component list, blocks optimistic submit, and provides 1-click links to "Board Intake" (`/shop-floor/boards`) or "Receive Deliveries" (`/shop-floor/receipts`) plus a live "Check Again" button.
    - Edge banding services and service products are exempt (`isStockExemptEdgeBandingService`).
  - **Odoo 19 Python Script & Server Actions**:
    - [scripts/odoo_enforce_mo_stock_rules.py](file:///c:/Users/ADMIN/Desktop/odooreconciler/scripts/odoo_enforce_mo_stock_rules.py) provides production-ready Odoo 19 Automated Actions / Server Actions and Python module overrides for `mrp.production` (`button_mark_done`, `button_plan`) and `mrp.workorder` (`button_start`, `do_finish`) to raise `odoo.exceptions.UserError` if component stock is missing in Odoo.
    - **Native Shop Floor "Close Production" Architecture**: In Odoo's native Shop Floor tablet/web interface, the "Close Production" button triggers `button_mark_done()` on `mrp.production`, NOT on `mrp.workorder`. Therefore, an Automation Rule on `mrp.production` (Trigger: On Update of `state`, Apply on: `[('state', 'in', ['progress', 'to_close', 'done'])]`, Before Update: `[('state', 'not in', ['done', 'cancel'])]`) is mandatory to intercept both "Close Production" and starting with partial stock.
    - **Work Centre Real-Time Display & SWR**: Work orders are grouped by work centre (Table Saw Area, Edge Banding Area, Panel Rack Area) and served in <10ms from MySQL snapshot cache (`shop_floor_shared_cache`). Badge attention counts poll asynchronously via `/shop-floor/api/app-badge-counts` without triggering synchronous Odoo XML-RPC calls during operator browsing.

- **Real-Time Event-Driven Odoo Sync Webhooks (Anti-Rate-Limiting Architecture)**:
  - **Endpoints**: `/api/webhooks/odoo-sync` and `/jobs/odoo-sync` (supporting both `POST` and `GET`).
  - **Security & Authorization**: Protected via token check supporting `env.ODOO_WEBHOOK_TOKEN`, `settings.scheduler.cronToken`, or `settings.poBillScheduler.cronToken` via `?token=`, `Authorization: Bearer <token>`, or `X-Odoo-Webhook-Token: <token>`.
  - **Zero-Block Immediate Response**: The endpoint responds immediately (<20ms) with `HTTP 200 OK` (`status: 'queued'`) so Odoo Automated Actions and webhooks never block, hang, or hit timeouts.
  - **Targeted Background Invalidation**:
    - `type=mo` or `model=mrp.production`: Invalidates `shop-floor-dashboard:` cache and triggers `syncPendingProcessesFromOdoo(true)` to update board intake requirements in MySQL.
    - `type=picking` or `model=stock.picking`: Invalidates `shop-floor-dashboard:`, `shop-floor:receipts:`, `shop-floor:deliveries:` and refreshes local stock product mirror (`refreshStockMirror()`).
    - `type=stock` or `model=stock.quant`: Invalidates dashboard and refreshes stock mirror.
    - Default or `type=all`: Executes combined cache invalidation and background syncs safely.
  - **Strict Company Isolation**: Payloads for company ID 3 or record names starting with `VA/` (URBAN VIBE 2) are automatically intercepted and ignored (`status: 'ignored'`).
  - **Odoo 19 Automated Action Script**: [scripts/odoo_sync_webhooks_automated_actions.py](file:///c:/Users/ADMIN/Desktop/odooreconciler/scripts/odoo_sync_webhooks_automated_actions.py) provides production-ready Python snippets and XML-RPC automated action configuration for Odoo 19.

- **Quotation Line Population & Discrepancy Verification**:
  - **Service**: [src/services/quotationSyncService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/quotationSyncService.ts) automatically invoked whenever a Job Summary PDF is extracted in [extractionService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/extractionService.ts).
  - **Template-Only Detection (`isTemplateOnlyQuotation`)**: A quotation is considered newly created if all product lines are strictly template placeholders (`Example Board 18mm` and `Optimised Panels`).
  - **Auto-Population on Template-Only Quotations**:
    - Replaces `Example Board 18mm` with the real board product from the Job Summary (e.g. `WHITE MDF 18mm`, sheets quantity). If multiple sheet materials are parsed, additional lines are created. If the board product cannot be uniquely resolved, creates a To-Do activity for the salesperson.
    - Updates `Optimised Panels` quantity to match `optimizedSheets`.
    - Automatically creates matching `Edge Banding Service <Color>` line(s) with quantity in meters rounded to nearest whole meter (`Math.round(length_mm / 1000)`).
  - **Discrepancy Verification on Customized Quotations ("Not less, but can be more")**:
    - If custom lines already exist, line creation is skipped to prevent duplicate order lines.
    - Compares board sheets, panel counts, and edging meters against the Job Summary.
    - If any quotation line quantity is LESS than the Job Summary (shortfall), creates an alert To-Do activity for the salesperson and posts a note in chatter. If quantities are equal or greater (surplus), marks lines as verified with zero modifications.
  - **Confirmed Orders**: Orders in `sale` or `done` states are never modified.

- **Purchase Order (PO) $\longleftrightarrow$ Job Summary Quantity Procurement Auditing**:
  - **Service**: [src/services/poJobSummaryAuditService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/poJobSummaryAuditService.ts) cross-checks Purchase Order lines (`purchase.order.line`) against the sheet material quantities and edge banding specified in the Job Summary PDF of the linked Sales Order (`origin` match, e.g. `S02182` or derived from `WH/MO/...`).
  - **Execution Scope**: Runs strictly on confirmed Purchase Orders (`state in ('purchase', 'done')`). Draft/sent POs are skipped until confirmed.
  - **Missing Job Summary on Associated Sales Order**:
    - If the associated Sales Order does not have a Job Summary PDF attached, automatically creates a To-Do activity for user **Charles** (with fallback to buyer): `"AWAIT JOB SUMMARY ATTACHMENT BEFORE APPROVING PO"`.
    - Note instructions: await or request Job Summary to be attached ASAP to the associated Sales Order log note area before approving the Purchase Order.
    - Posts an alert log note on the PO chatter tagging Charles (`@Charles`), and cross-posts an alert on the Sales Order chatter.
  - **Procurement Comparison Rules**:
    - **Edge Banding Products ("Not less, but can be more")**: Ordered meters must be $\ge$ required meters in the Job Summary. Extra meters are allowed without warnings.
    - **Boards (Particle Board, MDF, Plywood, etc. — Exact Match Rule)**: "Not less, but can be more" applies ONLY to edge banding, NOT boards. Board sheets must **EXACTLY MATCH** the Job Summary (`orderedSheets === requiredSheets`). Both under-ordering (shortfall) and over-ordering (excess) are flagged as mismatches.
  - **Stakeholder Notification Recipients**:
    - **Charles**
    - **Leoivard Ongule**
    - **Responsible Salesperson** (`user_id` on the Sales Order)
    - **Raphael Onyango**
  - **Match Reporting**:
    - If all board quantities match exactly and edge banding $\ge$ required: reports procurement match as log notes on both PO and Sales Order, mentioning and notifying the 4 stakeholders in Odoo.
  - **Mismatch Remediation**:
    - If any mismatch is detected: creates an urgent To-Do activity on the PO assigned to the Buyer (`res.users`) seeking written clarification explaining the mismatch or correction to be done.
    - Posts an itemized breakdown note on the PO Chatter detailing each shortfall or excess (e.g. *"WHITE MDF 18mm: Ordered 8 sheets, Job Summary requires 10 sheets — Short by 2 sheets"*), tagging all 4 stakeholders.
    - Cross-posts an alert note on the Sales Order Chatter so the salesperson has immediate visibility.
  - **Trigger Points**:
    - Webhook: `type=po` or `model=purchase.order` triggers `auditPurchaseOrderAgainstJobSummary`.
    - Webhook: `type=so` or `model=sale.order` triggers `auditLinkedPurchaseOrdersForSaleOrder` immediately following Job Summary extraction.
    - Automation: Triggered via 0-LOC Odoo 19 "Send Webhook Notification" action on `purchase.order` confirmation.

