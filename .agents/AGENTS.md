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
    - **Odoo Studio Mandatory Field `x_paid_by` ('Have you filled the name of the person who paid ?')**: Odoo model `account.payment.register` enforces a required Studio boolean checkbox `x_paid_by` ("Have you filled the name of the person who paid ?"). `registerPaymentForVendorBill` explicitly sets `wizardPayload.x_paid_by = true` and dynamically inspects `ir.model.fields` to also populate any companion payer name/user fields with `ALLOWED_NOTIFICATION_USER_NAME` (`'Leoivard Ongule'`), ensuring payment registration never fails on this requirement.
    - **Payment Retry & Activity Resolution Pipeline**: `retryFailedPoBillPayment` in [src/services/poBillAutomationService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/poBillAutomationService.ts) and route `POST /po-bill-automation/retry-payment` allow 1-click or scripted retries of failed payment registrations on posted bills. Upon registering payment, it automatically closes all matching open `'PO bill automation completed'` and `'Review PO bill automation'` activities across linked Purchase Orders, clearing any overdue alerts.
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
    - **Multi-Board Material Disambiguation Rule**: When a Job Summary contains multiple sheet materials sharing a common color or keyword (e.g. `WHITE MDF` and `WHITE WATERPROOF`), board product lines (e.g. `Cutting White MDF 18mm` and `Cutting White Waterproof 18mm`) are partitioned and matched strictly using `assignBoardLinesToSheetMaterials` based on substrate affinity (`mdf`, `waterproof`, `particle`, `plywood`), thickness, and distinctive keywords. Substrate mismatches carry a hard negative penalty, preventing cross-matching on common color words like "white" and eliminating false-positive excess/shortfall alerts.
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

- **Cutting Work Order & Manufacturing Order Quantity Reconciliation**:
  - **Service**: [src/services/workOrderQuantityReconciliationService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/workOrderQuantityReconciliationService.ts).
  - **Core Rule**: Whenever a Job Summary is parsed or an approved PO is checked, any Manufacturing Order (`mrp.production`) and Work Order (`mrp.workorder`) for cutting products (e.g. `Cutting White Mdf 18mm 6 panels`) whose quantity differs from the Job Summary/approved PO (e.g. Sales Order line says 6 panels, but Job Summary specifies 4 sheets/panels) has its quantities reconciled to match the Job Summary:
    1. **`mrp.production`**: `product_qty` updated to target quantity (e.g. 4), and `qty_producing` aligned if greater.
    2. **`mrp.workorder`**: `qty_production` (quantity to process) updated to target quantity (e.g. 4), and `qty_producing` aligned if greater.
    3. **`stock.move` (`raw_material_production_id`)**: Component board required quantity (`product_uom_qty`) updated to target quantity (e.g. 4).
    4. **Stock Reservation Allocation**: Triggers `action_assign` on `mrp.production` so raw stock reservation immediately re-evaluates against the exact required count, eliminating false shortages and enabling the operator to start/close without unreserved errors.
    5. **Audit Logging & Chatter**: Posts itemized reconciliation notes on `mrp.production` and `sale.order` chatter and records an audit log event.
    6. **Multi-Tier Cache Invalidation**: Automatically clears RAM and MySQL shop floor dashboard snapshots.
  - **Automatic Triggers**:
    - Job Summary extraction in [src/services/extractionService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/extractionService.ts) (`reconcileWorkOrderQuantitiesForSaleOrder`).
    - Purchase Order audit in [src/services/poJobSummaryAuditService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/poJobSummaryAuditService.ts) (`auditPurchaseOrderAgainstJobSummary` and `auditLinkedPurchaseOrdersForSaleOrder`).
    - Webhooks in [src/routes/jobs.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/jobs.ts) for `type=mo`, `type=po`, and `type=so`.

- **Inactive User Account Email Exclusion Rule**:
  - Inactive user accounts (`active = 0` / `active = false`) in `auth_approved_users` must **NEVER** appear as recipient choices, suggestions, or Quick Add buttons in any area where emails can be added (such as Board Log notification recipients, Email Automations recipients, and dynamic custom automations in [src/views/settings.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/settings.ejs)).
  - **Database Active Flag Parsing**: Database drivers (MySQL / SQLite) can return `active` as numeric `0`, string `'0'`, or boolean `false`. In JavaScript, `Boolean('0')` evaluates to `true`. Therefore, `parseDbActiveFlag(row.active)` in [src/models/repositories.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/models/repositories.ts) and `isAccountDeactivated` in [src/utils/accountStatus.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/utils/accountStatus.ts) explicitly treat `0`, `'0'`, `false`, and `'false'` as inactive.
  - The Settings controller ([src/routes/settings.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/settings.ts)) strictly filters `approvedUsers` with `(allApprovedUsers || []).filter(u => u && Boolean(u.active) && typeof u.email === 'string' && u.email.trim().length > 0)` before passing it to views, and the client-side template enforces `active` checks across both static and dynamically generated automation cards.

- **Built-in Email Automations Strict Deduplication Rule**:
  - The application provides 5 built-in operational email automations: `'shop-floor-reminders'`, `'weekly-shop-floor-report'`, `'mpesa-review'`, `'mo-overtime'`, and `'mo-stock-shortage-report'`.
  - Built-in operational emails must **NEVER** duplicate or appear more than once in the Admin Settings section (`#section-email-automation`), database, or cron dispatch loops.
  - `readMailConfig` in [src/models/repositories.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/models/repositories.ts), `buildMailConfigFromSource` in [src/routes/settings.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/settings.ts), and `updateMoStockShortageAutomationSettings` in [src/services/moStockShortageReportService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/moStockShortageReportService.ts) enforce strict single-instance uniqueness keyed by `systemKey`. Positional index fallbacks (`defaults.automations[index]`) are forbidden as they incorrectly converted custom automations at index 4 into duplicate `mo-stock-shortage-report` cards.

- **Instant Operator Profile Attendance Check-In & Check-Out Architecture**:
  - The Shop Floor Profile Banner in [src/views/shop-floor.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor.ejs) displays the Operator Avatar, Operator Name, Department/Job Title, attendance badge (`#headerAttendanceBadge`), and the Check In / Check Out button (`#headerAttendanceBtn`) side-by-side.
  - **Instant Optimistic UI (0ms Toggle)**: Clicking "Check In" or "Check Out" instantly toggles the button and status badge in 0ms (green "Checked In" with "Check Out" button or "Checked Out" with "Check In" button) without waiting for Odoo RPC network latency. If Odoo reports an error, the UI rolls back cleanly with a toast notification.
  - **Page-Wide State Synchronization**: All attendance buttons and badges (both in the top profile banner and within the attendance card) update in unison.
  - **Immediate In-Memory & MySQL Cache Updates**: Successful `/shop-floor/attendance/check-in` and `/shop-floor/attendance/check-out` calls instantly update the user's cached snapshot in `shopFloorCache` (RAM) and `shop_floor_dashboard_snapshots` (MySQL), ensuring that any subsequent navigation or page reload immediately reflects the updated attendance state without delay.
  - **Robust Employee Resolution**: `findEmployeeForShopFloorEmail` in [src/services/odooClient.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/odooClient.ts) and `resolveShopFloorEmployeeRecord` in [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts) search by `work_email`, `user_id.login`, user email, and employee name (`name ilike namePart`), ensuring operators are mapped even if `work_email` is blank in Odoo.
  - **Site Attendance Validation**: `canUseSiteAttendance(req)` allows admins/shop-floor-managers unconditionally for testing, allows localhost, and inspects all comma-separated client IPs from `x-forwarded-for` against allowed IPs to prevent reverse proxy lockouts.

- **Daily Manufacturing Order (MO) Stock Shortage & Board Audit Pipeline**:
  - **Service**: [src/services/moStockShortageReportService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/moStockShortageReportService.ts) and [src/services/boardProductClassifier.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/boardProductClassifier.ts).
  - **Audit Scope**: All active MOs (`state in ('confirmed', 'progress', 'to_close')`) strictly for company 1 (`URBAN VIBE INTERIOR DESIGN COMPANY LTD`), permanently excluding company 3 and `VA/` prefixes.
  - **Shortage Categorization & Root Causes**:
    1. **Critical Board Mismatch (`board_mismatch` - Red Alert)**:
       - Detects when a board of the **same color family** was logged against the client in Board Intake (`board_intake_queue`), but has an **incompatible substrate** (`mdf` vs `particle`, `plywood` vs `mdf`) or **incompatible thickness** (`18mm` vs `16mm`).
       - Flagged with top-level executive RED ALERT banners and highlighted in order tables to prevent factory cutting errors before sawing starts.
    2. **Pending Warehouse Receipt (`pending_receipt` - Amber Alert)**:
       - Component move has an open incoming vendor transfer in `stock.picking` (`state in ('draft', 'waiting', 'confirmed', 'assigned')`) not yet received/validated in the Receipt App.
    3. **Awaiting Board Intake (`awaiting_board_intake` - Blue Alert)**:
       - Board material has not yet been logged in the Board Intake App for the client.
    4. **Unprocured Hardware (`unprocured_hardware` - Grey Alert)**:
       - Hardware / component without any incoming vendor transfer or PO covering it.
  - **Endpoints & Delivery**:
    - **Interactive Web Preview**: `GET /reports/mo-stock-shortage` (instant SWR cached view, supports `?refresh=true`).
    - **Manual Dispatch**: `POST /reports/mo-stock-shortage/send`.
    - **Automated Webhook / Cron Trigger**: `GET /jobs/mo-stock-shortage` (token-protected).
    - **Scheduled Email**: Daily at 8:00 AM Nairobi time via `emailAutomationService.ts` (`systemKey: 'mo-stock-shortage-report'`).

- **PO Bill Automation Activity Deduplication**:
  - `createPurchaseOrderActivity()` in [src/services/poBillAutomationService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/poBillAutomationService.ts) enforces strict anti-duplication both via an in-memory 1-hour cache and pre-flight Odoo queries (`findOpenActivities`).
  - When `'PO bill automation completed'` is created, it automatically finds and marks any open `'Review PO bill automation'` activities as done (`closeActivities()`), preventing redundant to-do tasks from lingering on purchase orders.

- **Non-Blocking Background Board Reversion**:
  - `POST /shop-floor/board-intake/:id/revert` in [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts) atomically claims the revert in MySQL (`claimBoardIntakeRevert`, status `'reverting'`) and returns immediately (<10ms).
  - Background task dispatches `OdooClient.removeBoardsFromStock` and calls `finishBoardIntakeRevert`.
  - UI in [src/views/shop-floor-boards.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor-boards.ejs) displays `'Reverting in background...'` and tracks completion without freezing the screen.

- **Strict Vendor Receipt Restriction (BITCHER ONYANGO $\longleftrightarrow$ TINT INTERIOR)**:
  - User **BITCHER ONYANGO** (`isBitcherOnyangoUser`) is strictly barred from receiving or validating any purchase receipt item originating from vendor **TINT INTERIOR** (`isTintInteriorVendor`).
  - **In-App Receipt View**: [src/views/shop-floor-receipts.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor-receipts.ejs) renders a disabled `<button>` (`"Restricted (Tint Interior)"`) and alert badge for Bitcher Onyango when the vendor is Tint Interior.
  - **Server-Side Enforcement**: `POST /shop-floor/receipts/:id/validate` in [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts) queries the picking's vendor in Odoo if the user is Bitcher Onyango and blocks execution with `HTTP 403` (`code: 'vendor_restricted'`). All other operators are permitted to receive normally.

- **Instant Manufacturing Order Start and Close**:
  - While strictly preserving the Zero Unreserved Operations Rule (missing stock blocks with `HTTP 409`), once 100% of required components are verified in stock, `POST /shop-floor/work-order/:id/advance` responds immediately (<100ms) with `{ ok: true, state: targetState, message, employeeName }`.
  - `OdooClient.advanceManufacturingOrder` (and work order timer logging) executes asynchronously in the background.
  - [src/views/shop-floor.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor.ejs) dismisses the modal immediately, applies 0ms optimistic updates, and uses per-MO tracking (`activeMoSubmissions`) rather than a page-wide lock, giving operators an instant, non-blocking experience.

- **Add Stock / Board Intake Rules (Active PO Exclusion & History Log Persistence)**:
  - **Active PO Exclusion from Add Stock**:
    - Any Manufacturing Order (MO) that has an active Purchase Order (PO) in **any state** (`draft`, `sent`, `to approve`, `purchase`, `done` — i.e. `state != 'cancel'`), where the related Sales Order (SO) has board order lines (category `Goods / Boards` or matching board product patterns) and the PO covers the same boards, must **NOT appear in the ADD STOCK area** (`/shop-floor/boards`, `localStockAlerts`, or `/shop-floor/boards/requirements`) as requiring manual board logs.
    - Stock is expected from vendor delivery via the Receipts app (`/shop-floor/receipts`) upon PO approval and receipt validation.
    - When `syncPendingProcessesFromOdoo` runs, any existing pending records for PO-covered MOs and board products are purged via `poCoveredKeys`.
    - In [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts), `hasActivePo = Boolean(poState && poState !== 'cancel')` marks MO stock status as `'incoming'` ("Incoming / Purchase") and suppresses `localStockAlerts`.
  - **History Log Persistence Rule ("Only disappears if a history log that matches it appears")**:
    - When a job is closed in Odoo shop floor (`state in ('to_close', 'done')`) or uses another client's/unreserved stock, the required stock log record in the Add Stock area (`shop_floor_pending_processes`) **ONLY disappears if a matching history log in `board_intake_queue` (`status in ('synced', 'processing', 'pending')`) appears and fulfills the required quantity**.
    - If no operator physically logged the boards at the gate, the requirement is **NEVER pruned or deleted** by background sync or cleanup jobs; it is permanently preserved as `status = 'pending'` so missing client stock is never lost.
    - If a matching history log is reverted by an administrator, `unmarkPendingShopFloorProcessesLoaded` automatically restores `qty_missing` and resets status to `'pending'`, causing the requirement to immediately reappear in the Add Stock area.

- **Operator MO Lifecycle Control (Start, Pause, Close) & Zero-404 Architecture**:
  - **Resolution of "PAGE NOT FOUND, /shop-floor does not exist"**:
    - Previously, action modals had empty form actions (`action=""`) which defaulted browser form submissions to `POST /shop-floor`. Because only `GET /shop-floor` was registered, submissions produced a 404 error page.
    - Added dedicated `POST /shop-floor` endpoint in [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts) that gracefully forwards start, pause, and finish actions to `handleAdvanceMo` and `handlePauseMo`, or redirects to `/shop-floor` without ever 404ing.
    - Added route aliases and auth permissions for `/shopfloor`, `/shop_floor`, and `/shop` across [src/services/authService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/authService.ts) and [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts).
    - Hardened modal triggers in [src/views/shop-floor.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor.ejs) via delegated click listeners (`configureMoModal`) that ensure target MO IDs and form actions are always populated before modals open or submit.
  - **Starting Manufacturing Orders**:
    - Operators tap "Start" on confirmed MOs (or "Continue" on paused MOs).
    - Zero Unreserved Operations rule enforces 100% component availability via `checkManufacturingOrderStockAvailability`.
    - Responds instantly (<100ms) with optimistic UI progress state while background worker starts the Odoo work order and tracks employee attendance.
  - **Pausing Manufacturing Orders**:
    - Operators tap "Pause" on in-progress MOs to open `#pauseMoModal`.
    - Allows recording units completed so far (`qtyProduced`) and toggling backorders for remaining units (`createBackorder`).
    - Handled via `POST /shop-floor/work-order/:id/pause` and `OdooClient.pauseManufacturingOrder`: invokes `stop_employee` and `button_pending` on the active work order in Odoo, logs audit note in chatter, records MO in `manuallyPausedMoIds`, and clears shared caches.
    - UI updates optimistically to show the "Paused" badge and provides "Continue" and "Finish" buttons.
  - **Closing Manufacturing Orders**:
    - When finishing the final work order on an MO, `OdooClient.advanceManufacturingOrder` checks if any uncompleted work orders remain. When none remain (or if the MO is already in `to_close` state), it automatically executes `button_mark_done` on `mrp.production` to officially close the Manufacturing Order in Odoo.

- **Board Intake Chatter Cross-Posting to Related Sales Orders & Manufacturing Orders**:
  - Whenever boards are logged in the Operator Mobile App (`/shop-floor/boards`, `board_intake_queue`), an email notification is always sent to the configured recipient (`boardLogNotificationEmail`, e.g. Sharon).
  - In [src/services/boardIntakeSyncService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/boardIntakeSyncService.ts) and [src/services/odooClient.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/odooClient.ts) (`findMOsForBoardIntake`), matching active MOs for the client and board product are resolved alongside their linked Sales Orders (`soId`, `soName`, `soUserId`, `soUserName`).
  - **Tagging Rule (Responsible Salesperson or Candy & Sharon Always)**:
    - The chatter message strictly **starts with tagging the responsible salesperson** (`<a href="#" data-oe-model="res.partner" data-oe-id="${partnerId}">@${name}</a>`).
    - If the related Sales Order does not have an assigned salesperson (or is assigned to admin / unassigned), it **always tags both Candy and Sharon** (`@Candy @Sharon`).
    - In both cases, the resolved partner IDs are passed to `client.postModelChatterMessage(model, id, message, partnerIds)` so Odoo dispatches notifications directly to them.
  - **Tree Log Emoji Removal Rule**:
    - The tree log emoji (`🪵 `) is strictly removed from the chatter title line; it starts cleanly as `<strong>Board log completed (Operator Mobile App)</strong>`.
  - **PO Board Exclusion in findMOsForBoardIntake**:
    - In `findMOsForBoardIntake`, MOs whose related Sales Order (or MO) has an active Purchase Order for that board product are strictly **excluded** from intake matching, as vendor-purchased boards are expected through Receipts.
    - If any board PO notice is required on orders, it prompts the team to communicate with operators on whether it is a purchase or client-supplied.
  - **Cross-Posting Rule**:
    - If a matching Manufacturing Order exists AND has a linked Sales Order, the formatted HTML chatter message is posted to **BOTH** the Manufacturing Order (`mrp.production`) and the **related Sales Order** (`sale.order`).
    - The message contains **100% of the details that go to email**:
      - Stakeholder Tags (`@Salesperson` or `@Candy @Sharon`)
      - Client Name
      - Board Product Name
      - Quantity
      - Manufacturing Order reference (`WH/MO/...`)
      - Gate (`Front Gate` / `Back Gate` / `—`)
      - Vehicle Registration (`—` if not provided)
      - Arrival Time (`—` if not provided)
      - Arrival Date (or today's date)
      - Logged by (operator display name or email)
      - Purchase Order communication notice (when PO exists for this board)
  - **No Matching MO / SO Rule**:
    - If there is no matching MO or no linked Sales Order for the logged boards, no chatter call is made to non-existent orders; the board intake record **only goes to email** without throwing any errors.

- **Full Boards Only (No Decimals / Offcuts Rule)**:
  - In [src/views/shop-floor-boards.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor-boards.ejs), the intake quantity field (`#intakeQty`) is strictly configured with `min="1" step="1" inputmode="numeric"`.
  - Typing decimal characters (`.`, `,`, `e`, `-`, `+`), pasting decimals, or submitting non-integers is completely blocked.
  - An inline red error state and a 5-second responsive center popup (`#decimalPopupModal`) dynamically appears: *"Only full boards can be logged. Offcuts do not need logging."* and auto-dismisses.
  - The backend (`POST /shop-floor/board-intake` in [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts)) strictly enforces `Number.isInteger(qty) && qty % 1 === 0`, rejecting any decimal submissions with HTTP 400.

- **Board Registration vs Expected Logs Truth & Stock Needed Reconciliation Rule**:
  - The **"Board Registration vs Expected Logs"** summary card (`boardRegistrationSummary`) and **"Stock Needed — No Purchase Orders"** area (`stockAlerts` / `shop_floor_pending_processes`) must NEVER contradict each other.
  - **Anti-False-Positive Odoo Move Matching**: In `getBoardRegistrationSummary` ([src/services/odooClient.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/odooClient.ts)), physical inventory moves are NEVER matched purely on product name. Unreserved cutting MOs require an inventory adjustment specifically matching the MO or SO origin/reference (`moveMatchesMoOrSo`); warehouse-wide moves for unrelated clients cannot falsely mark an MO as registered.
  - **Dynamic Stock Alert Reconciliation**: In [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts), `reconcileBoardRegistrationWithStockAlerts` reconciles `boardRegistrationSummary` against active pending stock alerts (`stockAlerts`). If undone board items exist (e.g. 2 undone items totaling 12 boards):
    - `missingBoards` / `missingMoves` reflects the active undone items.
    - `missingBoardSheets` reflects the exact missing board quantity (e.g. 12 boards).
    - `coveragePercent` is strictly $< 100\%$ (e.g. 98%), and the card displays warning/alert colors (`#fef2f2`, `#fecaca`, `#991b1b`).
    - The UI in [src/views/shop-floor.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/shop-floor.ejs) displays both the undone items and the missing board sheets (`X boards needed`), ensuring complete truthfulness and parity with the Stock Needed area.

- **Board Log Intake Notification Hardcoded Recipient Rule**:
  - Email address `urbanvibeinteriordesign@gmail.com` (`HARDCODED_BOARD_LOG_NOTIFICATION_EMAIL` in [src/utils/helpers.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/utils/helpers.ts)) is permanently hardcoded to receive all factory board log intake notifications (both new entries and cancellations/reverts).
  - **Normalization & Retention**: `normalizeBoardLogRecipients()` in [src/utils/helpers.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/utils/helpers.ts) guarantees that `urbanvibeinteriordesign@gmail.com` is always prepended to the recipient list under all conditions (empty input, default fallback, or custom user edits). It can never be stripped or deleted.
  - **Zero-Loss Admin Settings Synchronization**:
    - The Settings view ([src/views/settings.ejs](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/views/settings.ejs)) keeps `urbanvibeinteriordesign@gmail.com` locked as a permanent primary recipient badge without a delete button.
    - Synchronized hidden inputs (`#stockBoardLogNotificationEmail` and `#mainFormStockBoardLogNotificationEmail`) exist across both the Outgoing Mail form and the main Settings form, guaranteeing that saving Odoo credentials, Stock settings, or "Save All Settings" never clears board log recipients.
    - In [src/routes/settings.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/settings.ts) and [src/models/repositories.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/models/repositories.ts), all settings loads (`getSettings`, `buildFormValues`) and saves (`saveSettings`, `POST /settings/mail`, `POST /settings`) run through `normalizeBoardLogRecipients()`.
    - Both board log creation and board log revert handlers in [src/routes/shopFloor.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/routes/shopFloor.ts) use `normalizeBoardLogRecipients()` to guarantee dispatch to `urbanvibeinteriordesign@gmail.com`.

- **Partial Board Intake Requirement & Balance Retention Rule**:
  - **Zero Destructive Reduction**: When a Manufacturing Order (MO) requires 10 boards and the operator logs a partial intake (e.g. 5 boards), the system must **NEVER** reduce or alter the MO's raw component requirement (`product_uom_qty` on `stock.move` remains 10).
  - **Preserving Stock Shortage**: The intake adds the 5 logged boards into physical inventory and reserves them via `action_assign` (`client.reserveStockOnMOs`). The remaining balance (5 boards) stays active as an unreserved stock shortage in Odoo, preventing the MO from starting or closing with partial stock.
  - **Shop Floor Process Tracking (`shop_floor_pending_processes`)**: `markPendingShopFloorProcessesLoaded` calculates `qty_reserved = 5`, `qty_missing = 5`, and leaves `status = 'pending'`, ensuring the remaining balance of 5 boards continues to appear in the "Add Stock" / pending requirements area.
  - **Itemized Balance Chatter & Email Reporting**:
    - Chatter notes posted to `mrp.production` and `sale.order` explicitly state:
      - `• Quantity: 5 sheets`
      - `• Total Required: 10 sheets`
      - `• Balance Remaining: 5 sheets needed`
      - Partial intake alert callout: `⚠️ PARTIAL INTAKE: 5 sheets logged, balance 5 sheets still required for WH/MO/xxxx. Stock requirement of 5 boards remains active before cutting/completion can start.`
    - Complete intake badge: When all required boards are supplied, notes display `✅ COMPLETE INTAKE: All 10 sheets received and allocated in stock.`
    - Real-time board log emails and UI success banners explicitly include the balance needed (e.g. `(Partial: 5 logged, balance 5 of 10 needed for WH/MO/xxxx)`).
  - **Unlogged Balance Card Visibility (Zero Premature Locking)**:
    - When an operator logs 5 boards for a 10-board requirement, the remaining balance of 5 boards is **UNLOGGED** and must remain active in the "Stock Needed — No Purchase Orders" section (`/shop-floor/boards`) and main dashboard (`/shop-floor`).
    - **No Double Deduction**: Alerts and requirements originating from MySQL `shop_floor_pending_processes` already have the logged quantity deducted; they must never be passed to `applyOptimisticStockAlerts` or `applyOptimisticBoardIntakes` which would subtract the 5 a second time and erase the card.
    - **`isSyncing: false` for Balance**: The card represents the unlogged balance of 5 boards. Because it has not been logged, it is strictly `isSyncing: false` (not locked as syncing).
    - **Active Card & Fill Form Button**: The card dynamically displays `Balance: 5 needed` and `5 of 10 logged`, and its "Fill Form" button remains fully active with `data-qty="5"` so the operator can click it to immediately log the remaining balance when it arrives.
    - **Client-Side SWR Parity**: Upon submitting a partial intake, client-side JavaScript decrements the card's needed quantity to the remaining balance instead of removing it or locking it into `item-syncing-locked`.

- **Work Order / MO Closed Without Stock Logged Detection & Visibility Rule**:
  - **Purpose**: Solves the critical factory vulnerability where a work order (`mrp.workorder`) or manufacturing order (`mrp.production`) is marked complete or closed in Odoo (either by an operator bypassing stock validation or using someone else's unassigned boards), but the required raw boards were **NEVER logged at the factory gate** (`board_intake_queue`).
  - **Database Persistence (`is_mo_closed`)**:
    - Column `is_mo_closed` (`INTEGER` / `TINYINT(1)` DEFAULT 0) in `shop_floor_pending_processes` records whether the parent Manufacturing Order or Work Order was closed in Odoo without matching board intake history logs.
    - Added dynamically in `ensureSqliteDatabase` and `ensureMysqlDatabase`.
  - **Zero-Drop Pruning Retention**:
    - In `pruneStalePendingProcessesForActiveMos` ([src/models/repositories.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/models/repositories.ts)), if an MO is closed or marked done in Odoo (`!activeSet.has(row.mo_id)`), the row is **STRICTLY PRESERVED** in MySQL as long as no matching history log exists (or total logged < qty needed).
    - It sets `is_mo_closed = 1`, turning the unlogged requirement into an active discrepancy alert.
  - **Recently Closed MO Discovery**:
    - In `syncPendingProcessesFromOdoo` ([src/services/shopFloorPendingSyncService.ts](file:///c:/Users/ADMIN/Desktop/odooreconciler/src/services/shopFloorPendingSyncService.ts)), background sync inspects both active MOs and recently closed/done MOs (`state = 'done'`, past 7 days). Any closed MO whose board moves lack matching history logs is ingested into `shop_floor_pending_processes` with `is_mo_closed = 1`.
  - **Prominent UI Visibility**:
    - **Board Intake / Add Stock Page (`/shop-floor/boards`)**:
      - Top summary header displays a prominent badge: `🚨 X WORK ORDER CLOSED WITHOUT STOCK LOGGED`.
      - The client group container turns into an alert block with red accent borders (`border-color: #fca5a5; background: #fff1f2;`) and an `ALERT` badge.
      - Each affected card prominently renders:
        `🚨 WORK ORDER CLOSED BUT STOCK NOT YET LOGGED` (with `Action Required` badge).
      - Subtitle explains: `🚨 Work Order / MO marked complete in Odoo · stock NOT logged!`.
      - The 1-click **"Fill Form"** button remains fully functional and accessible, allowing the gate operator or supervisor to immediately record the intake.
    - **Main Shop Floor Dashboard (`/shop-floor`)**:
      - Displays a top high-priority alert banner: `🚨 X Work Order(s) Closed But Stock Not Yet Logged!` with direct action link: *"Review & Log Stock in Add Stock →"*.
      - Under **Penalty Signals**, a dedicated KPI card `Closed Without Stock: X` highlights the count in bold red.


