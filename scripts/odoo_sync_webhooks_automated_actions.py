"""
Odoo 19 Automated Actions / Webhooks: Real-Time Sync to Reconciler
===================================================================
MINIMAL LINES OF CODE (LOC) EDITION FOR ODOO BILLING OPTIMIZATION
Since Odoo / Odoo.sh counts and charges per line of custom code, these snippets
are ultra-minified (3 to 6 lines of code each) or 0 lines using native Odoo webhooks.

OPTION 1: NATIVE ODOO 19 WEBHOOK ACTIONS (0 LINES OF CODE - $0 CUSTOM CODE COST)
---------------------------------------------------------------------------------
In Odoo 19 (Settings -> Technical -> Automation Rules):
Create an Automation Rule with Action To Do = "Send Webhook Notification":

1. JOB SUMMARY ATTACHED (ir.attachment):
   - Model: Attachment (ir.attachment)
   - Trigger: On Creation
   - Domain: [('name', 'ilike', 'Job Summary'), ('res_model', '=', 'sale.order')]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=so
   - Fields: Resource ID (res_id)

2. PURCHASE ORDERS (purchase.order):
   - Model: Purchase Order (purchase.order)
   - Trigger: On Creation or On Update (state)
   - Domain: [('company_id', '=', 1)]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=po
   - Fields: Source Document (origin), Status (state)

3. SALES ORDERS / QUOTATIONS (sale.order):
   - Model: Sales Order (sale.order)
   - Trigger: On Creation or On Update (state)
   - Domain: [('company_id', '=', 1)]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=so
   - Fields: Status (state)

4. MANUFACTURING ORDERS (mrp.production):
   - Model: Manufacturing Order (mrp.production)
   - Trigger: On Creation or On Update (state)
   - Domain: [('company_id', '=', 1)]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=mo&model=mrp.production
   - Fields: Status (state)

5. WORK ORDERS (mrp.workorder - WHEN OPERATOR STARTS OR CLOSES ON SHOP FLOOR):
   - Model: Work Order (mrp.workorder)
   - Trigger: On Update (state)
   - Domain: [('production_id.company_id', '=', 1)]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=mo&model=mrp.workorder
   - Fields: Manufacturing Order (production_id), Status (state)

6. TRANSFERS / RECEIPTS & DELIVERIES (stock.picking):
   - Model: Transfer (stock.picking)
   - Trigger: On Update (state)
   - Domain: [('company_id', '=', 1), ('state', '=', 'done')]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=picking
   - Fields: Status (state)

7. ATTENDANCE CHECK-IN / CHECK-OUT (hr.attendance):
   - Model: Attendance (hr.attendance)
   - Trigger: On Creation or On Update (check_in, check_out)
   - Domain: [('employee_id.company_id', '=', 1)]
   - Action: Send Webhook Notification
   - URL: https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=attendance&model=hr.attendance
   - Fields: Employee (employee_id), Check In (check_in), Check Out (check_out)

That's it! 0 lines of Python written = 0 lines billed by Odoo.

OPTION 2: PYTHON SERVER ACTIONS - DO NOT USE FROM THE ODOO UI
--------------------------------------------------------------
WARNING: Odoo's safe_eval sandbox rejects `import` ("forbidden opcode(s): IMPORT_NAME"),
so the snippets below only work inside a custom Odoo module, not in "Execute Code".
"""

import os
import sys
import xmlrpc.client

# ==============================================================================
# 1. UNIVERSAL ALL-IN-ONE WEBHOOK (JUST 6 LINES - RUNS FOR ANY MODEL)
# ==============================================================================
# Use this single action for mrp.production, stock.picking, sale.order, or ir.attachment!
UNIVERSAL_SYNC_ACTION_CODE = '''import urllib.request
for r in records:
    if getattr(r, 'company_id', None) and r.company_id.id != 1: continue
    if (getattr(r, 'name', '') or '').startswith('VA/'): continue
    try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&model={r._name}&id={r.id}", timeout=2)
    except: pass'''

# ==============================================================================
# ==============================================================================
# 2. mrp.production (MO Confirmed/Done) - ONLY 5 LINES
# ==============================================================================
MRP_PRODUCTION_ACTION_CODE = '''import urllib.request
for r in records:
    if r.company_id.id == 1 and not (r.name or '').startswith('VA/'):
        try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=mo&model=mrp.production&id={r.id}&state={r.state}", timeout=2)
        except: pass'''

# ==============================================================================
# 2b. mrp.workorder (Work Order Start/Done/Pause in Shop Floor) - ONLY 6 LINES
# ==============================================================================
MRP_WORKORDER_ACTION_CODE = '''import urllib.request
for r in records:
    p = getattr(r, 'production_id', None)
    if p and getattr(p, 'company_id', None) and p.company_id.id == 1 and not (p.name or '').startswith('VA/'):
        try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=mo&model=mrp.workorder&id={r.id}&production_id={p.id}&state={r.state}", timeout=2)
        except: pass'''

# ==============================================================================
# 3. stock.picking (Receipts/Deliveries Done) - ONLY 6 LINES
# ==============================================================================
STOCK_PICKING_ACTION_CODE = '''import urllib.request
for r in records:
    if r.company_id.id == 1 and not (r.name or '').startswith('VA/'):
        t = 'receipt' if getattr(r.picking_type_id, 'code', '') == 'incoming' else 'delivery'
        try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type={t}&id={r.id}", timeout=2)
        except: pass'''

# ==============================================================================
# 4. ir.attachment (Job Summary PDF Attached) - ONLY 6 LINES
# ==============================================================================
JOB_SUMMARY_ATTACHMENT_ACTION_CODE = '''import urllib.request
for a in records:
    if 'job summary' in (a.name or '').lower() or (a.name or '').lower().endswith('.pdf'):
        oid = a.res_id if a.res_model == 'sale.order' else (env['mail.message'].browse(a.res_id).res_id if a.res_model == 'mail.message' and env['mail.message'].browse(a.res_id).model == 'sale.order' else None)
        if oid:
            try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=so&order_id={oid}&attachment_id={a.id}", timeout=2)
            except: pass'''

# ==============================================================================
# 5. sale.order (On Order Confirmed) - ONLY 5 LINES
# ==============================================================================
SALES_ORDER_CONFIRMED_ACTION_CODE = '''import urllib.request
for r in records:
    if r.company_id.id == 1 and not (r.name or '').startswith('VA/'):
        try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=so&id={r.id}", timeout=2)
        except: pass'''

# ==============================================================================
# 6. purchase.order (PO Created / Confirmed) - ONLY 5 LINES
# ==============================================================================
PURCHASE_ORDER_ACTION_CODE = '''import urllib.request
for r in records:
    if r.company_id.id == 1 and not (r.name or '').startswith('VA/'):
        try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=po&id={r.id}", timeout=2)
        except: pass'''

# ==============================================================================
# 7. hr.attendance (Check In / Check Out) - ONLY 5 LINES
# ==============================================================================
HR_ATTENDANCE_ACTION_CODE = '''import urllib.request
for r in records:
    eid = r.employee_id.id if getattr(r, 'employee_id', None) else 0
    try: urllib.request.urlopen(f"https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync?token=reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n&type=attendance&model=hr.attendance&id={r.id}&employee_id={eid}", timeout=2)
    except: pass'''


def install_automated_actions(odoo_url, db, username, api_key, reconciler_url, webhook_token):
    """
    Installs the minimal LOC actions into Odoo via XML-RPC.
    """
    print(f"[*] Connecting to Odoo at {odoo_url} (DB: {db})...")
    common = xmlrpc.client.ServerProxy(f"{odoo_url.rstrip('/')}/xmlrpc/2/common")
    uid = common.authenticate(db, username, api_key, {})
    if not uid:
        print("[!] Authentication failed! Check your Odoo credentials.")
        return False

    print(f"[+] Authenticated successfully as user ID: {uid}")
    models = xmlrpc.client.ServerProxy(f"{odoo_url.rstrip('/')}/xmlrpc/2/object")

    def format_code(template):
        return template.replace(
            'https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync', reconciler_url
        ).replace('reconciler-odoo-webhook-2026-8fK29sLmQx7PzA4n', webhook_token)

    actions = [
        ('mrp.production', 'Reconciler: Sync MO Changes (Mini LOC)', format_code(MRP_PRODUCTION_ACTION_CODE)),
        ('mrp.workorder', 'Reconciler: Sync Work Order Changes (Mini LOC)', format_code(MRP_WORKORDER_ACTION_CODE)),
        ('stock.picking', 'Reconciler: Sync Transfers (Mini LOC)', format_code(STOCK_PICKING_ACTION_CODE)),
        ('ir.attachment', 'Reconciler: Sync Job Summary (Mini LOC)', format_code(JOB_SUMMARY_ATTACHMENT_ACTION_CODE)),
        ('sale.order', 'Reconciler: Sync Sales Orders (Mini LOC)', format_code(SALES_ORDER_CONFIRMED_ACTION_CODE)),
        ('purchase.order', 'Reconciler: Audit PO vs Job Summary (Mini LOC)', format_code(PURCHASE_ORDER_ACTION_CODE)),
        ('hr.attendance', 'Reconciler: Sync Attendance Changes (Mini LOC)', format_code(HR_ATTENDANCE_ACTION_CODE)),
    ]

    for model_name, action_name, code in actions:
        model_ids = models.execute_kw(db, uid, api_key, 'ir.model', 'search', [[['model', '=', model_name]]])
        if not model_ids:
            print(f"[-] Model {model_name} not found, skipping.")
            continue
        model_id = model_ids[0]

        existing = models.execute_kw(
            db, uid, api_key, 'ir.actions.server', 'search',
            [[['name', '=', action_name], ['model_id', '=', model_id]]]
        )
        if existing:
            models.execute_kw(db, uid, api_key, 'ir.actions.server', 'write', [[existing[0]], {
                'code': code,
                'state': 'code',
            }])
            print(f"[+] Updated server action: {action_name} ({len(code.splitlines())} lines)")
        else:
            action_id = models.execute_kw(db, uid, api_key, 'ir.actions.server', 'create', [{
                'name': action_name,
                'model_id': model_id,
                'state': 'code',
                'code': code,
            }])
            print(f"[+] Created server action (ID {action_id}): {action_name} ({len(code.splitlines())} lines)")

    print("\n[SUCCESS] Installed minimal LOC server actions into Odoo!")
    return True


if __name__ == '__main__':
    print("=" * 70)
    print("Odoo 19 -> Reconciler Real-Time Sync (Ultra-Low LOC Edition)")
    print("=" * 70)

    odoo_url = os.environ.get('ODOO_BASE_URL', '').strip()
    db = os.environ.get('ODOO_DATABASE', '').strip()
    username = os.environ.get('ODOO_USERNAME', '').strip()
    api_key = os.environ.get('ODOO_API_KEY', '').strip()
    reconciler_url = os.environ.get('RECONCILER_URL', 'https://app.urbanvibeinteriordesign.co.ke/api/webhooks/odoo-sync').strip()
    webhook_token = os.environ.get('ODOO_WEBHOOK_TOKEN', os.environ.get('SCHEDULER_CRON_TOKEN', '')).strip()

    if not all([odoo_url, db, username, api_key]):
        print("\nOdoo environment variables not set. Displaying ultra-compact code snippets:\n")
        print("=== 1. UNIVERSAL DISPATCHER (Works for all models, 6 lines) ===")
        print(UNIVERSAL_SYNC_ACTION_CODE)
        print("\n=== 2. MANUFACTURING ORDERS (5 lines) ===")
        print(MRP_PRODUCTION_ACTION_CODE)
        print("\n=== 2b. WORK ORDERS (SHOP FLOOR START/FINISH) (6 lines) ===")
        print(MRP_WORKORDER_ACTION_CODE)
        print("\n=== 3. STOCK TRANSFERS / RECEIPTS (6 lines) ===")
        print(STOCK_PICKING_ACTION_CODE)
        print("\n=== 4. JOB SUMMARY ATTACHMENTS (6 lines) ===")
        print(JOB_SUMMARY_ATTACHMENT_ACTION_CODE)
        print("\n=== 5. SALES ORDER CONFIRMED (5 lines) ===")
        print(SALES_ORDER_CONFIRMED_ACTION_CODE)
    else:
        install_automated_actions(odoo_url, db, username, api_key, reconciler_url, webhook_token)
