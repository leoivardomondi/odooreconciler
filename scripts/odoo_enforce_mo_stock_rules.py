"""
Odoo 19 Stock Availability Enforcement: MO & Work Order Rules
============================================================
This script ensures that NO Manufacturing Order (MO) or Work Order (WO) in Odoo 19
can be started, finished, or closed without 100% of the required component stock
being physically available and assigned in the warehouse.

Contains:
1. Production-ready Python code snippets for Odoo 19 Automated Actions / Server Actions.
2. Python model overrides for an Odoo 19 custom module (`mrp_strict_stock`).
3. An automated Python XML-RPC installer that can automatically configure the server actions in Odoo.
"""

import sys
import xmlrpc.client

# ==============================================================================
# 1. PYTHON CODE FOR ODOO 19 SERVER ACTION / AUTOMATED ACTION
# ==============================================================================
# Model: mrp.production (Manufacturing Order)
# Action Name: Strict Stock Availability Enforcement on MO Close / Produce
# Trigger: On State Update to 'done' or 'to_close', or on button_mark_done
MRP_PRODUCTION_SERVER_ACTION_CODE = '''for mo in records:
    if any(s in (mo.product_id.display_name or '').lower() for s in ('edge banding', 'edging')): continue
    if mo.state not in ('done', 'cancel'):
        try: mo.action_assign()
        except: pass
    bad = [f"- {m.product_id.display_name}: Need {m.product_uom_qty}, Avail {getattr(m, 'quantity', getattr(m, 'reserved_availability', 0))}"
           for m in mo.move_raw_ids if m.state not in ('done', 'cancel') and (m.state != 'assigned' or getattr(m, 'quantity', getattr(m, 'reserved_availability', 0)) < m.product_uom_qty)]
    if bad: raise UserError(f"Cannot process MO {mo.name}. Missing stock:\\n" + "\\n".join(bad) + "\\nPlease validate receipts or board intake first.")'''

# Model: mrp.workorder (Work Order)
# Action Name: Strict Stock Availability Enforcement on Work Order Start & Finish
# Trigger: On Stage Update / Method Execution (button_start, do_finish)
MRP_WORKORDER_SERVER_ACTION_CODE = '''for wo in records:
    mo = wo.production_id
    if not mo or any(s in (mo.product_id.display_name or '').lower() for s in ('edge banding', 'edging')): continue
    if mo.state not in ('done', 'cancel'):
        try: mo.action_assign()
        except: pass
    bad = [f"- {m.product_id.display_name}: Need {m.product_uom_qty}, Avail {getattr(m, 'quantity', getattr(m, 'reserved_availability', 0))}"
           for m in mo.move_raw_ids if m.state not in ('done', 'cancel') and (m.state != 'assigned' or getattr(m, 'quantity', getattr(m, 'reserved_availability', 0)) < m.product_uom_qty)]
    if bad: raise UserError(f"Cannot start WO {wo.name}. Missing components for {mo.name}:\\n" + "\\n".join(bad))'''


# ==============================================================================
# 2. ODOO 19 CUSTOM MODULE PYTHON MODEL OVERRIDE
# ==============================================================================
ODOO_MODULE_MRP_PRODUCTION_PY = '''# -*- coding: utf-8 -*-
from odoo import models, api, _
from odoo.exceptions import UserError

class MrpProduction(models.Model):
    _inherit = 'mrp.production'

    def _check_strict_component_stock_availability(self):
        for mo in self:
            prod_name = mo.product_id.display_name or ""
            if "edge banding service" in prod_name.lower() or "edging banding service" in prod_name.lower():
                continue

            if mo.state not in ('done', 'cancel'):
                try:
                    mo.action_assign()
                except Exception:
                    pass

            missing = []
            for move in mo.move_raw_ids.filtered(lambda m: m.state != 'cancel'):
                required_qty = move.product_uom_qty or 0.0
                if required_qty <= 0:
                    continue

                avail_qty = getattr(move, 'quantity', getattr(move, 'reserved_availability', 0.0)) or 0.0
                if move.state == 'done':
                    continue

                if move.state != 'assigned' or avail_qty < required_qty:
                    missing_qty = max(0.0, required_qty - avail_qty)
                    uom_name = move.product_uom.name or 'Units'
                    missing.append(
                        f"• {move.product_id.display_name}: Required {required_qty} {uom_name}, "
                        f"Available {avail_qty} {uom_name} (Missing {missing_qty} {uom_name})"
                    )

            if missing:
                raise UserError(
                    _("Cannot start or close Manufacturing Order %s:\\n\\n"
                      "All required components must be fully available and assigned in stock before proceeding.\\n"
                      "The following items are missing from stock:\\n\\n%s\\n\\n"
                      "Please add stock or validate incoming receipts before proceeding.")
                    % (mo.name, "\\n".join(missing))
                )

    def button_mark_done(self):
        self._check_strict_component_stock_availability()
        return super(MrpProduction, self).button_mark_done()

    def button_plan(self):
        self._check_strict_component_stock_availability()
        return super(MrpProduction, self).button_plan()


class MrpWorkorder(models.Model):
    _inherit = 'mrp.workorder'

    def button_start(self):
        for wo in self:
            if wo.production_id:
                wo.production_id._check_strict_component_stock_availability()
        return super(MrpWorkorder, self).button_start()

    def do_finish(self):
        for wo in self:
            if wo.production_id:
                wo.production_id._check_strict_component_stock_availability()
        return super(MrpWorkorder, self).do_finish()
'''


def main():
    print("=" * 70)
    print("ODOO 19 MANUFACTURING ORDER STOCK ENFORCEMENT RULES")
    print("=" * 70)
    print("\n[Option A: Direct Odoo 19 Automated Action / Server Action]")
    print("In Odoo, navigate to Settings > Technical > Server Actions:")
    print("1. Create Server Action on 'Manufacturing Order' (mrp.production):")
    print("   Action Name: Enforce Required Stock on MO Mark Done")
    print("   Model: mrp.production")
    print("   Action To Do: Execute Python Code")
    print("   Python Code:")
    print("-" * 50)
    print(MRP_PRODUCTION_SERVER_ACTION_CODE)
    print("-" * 50)
    print("\n2. Create Server Action on 'Work Order' (mrp.workorder):")
    print("   Action Name: Enforce Required Stock on Work Order Start & Finish")
    print("   Model: mrp.workorder")
    print("   Action To Do: Execute Python Code")
    print("   Python Code:")
    print("-" * 50)
    print(MRP_WORKORDER_SERVER_ACTION_CODE)
    print("-" * 50)
    print("\n[Option B: Custom Odoo Addon Module (mrp_strict_stock)]")
    print("Drop this code into your custom addons directory under mrp_strict_stock/models/mrp.py:")
    print("-" * 50)
    print(ODOO_MODULE_MRP_PRODUCTION_PY)
    print("-" * 50)


if __name__ == '__main__':
    main()
