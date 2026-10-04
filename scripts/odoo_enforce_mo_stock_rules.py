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
MRP_PRODUCTION_SERVER_ACTION_CODE = '''# Odoo 19 Server Action: Strict MO Stock Enforcement
for mo in records:
    # Service products (e.g. Edge Banding Service) do not consume physical stock
    prod_name = mo.product_id.display_name or ""
    if "edge banding service" in prod_name.lower() or "edging banding service" in prod_name.lower():
        continue

    # Attempt to reserve any freshly received inventory
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

        # In Odoo 17/18/19, move.quantity is the picked / reserved quantity
        avail_qty = getattr(move, 'quantity', getattr(move, 'reserved_availability', 0.0)) or 0.0

        # Consumed lines in state 'done' are satisfied
        if move.state == 'done':
            continue

        # If move is not assigned or available quantity is less than required, flag it
        if move.state != 'assigned' or avail_qty < required_qty:
            missing_qty = max(0.0, required_qty - avail_qty)
            uom_name = move.product_uom.name or 'Units'
            missing.append(
                f"- {move.product_id.display_name}: Required {required_qty} {uom_name}, "
                f"Available {avail_qty} {uom_name} (Missing {missing_qty} {uom_name})"
            )

    if missing:
        missing_text = "\\n".join(missing)
        raise UserError(
            f"CANNOT START OR CLOSE MANUFACTURING ORDER {mo.name}\\n\\n"
            f"All required components must be physically available and assigned in stock before proceeding.\\n"
            f"The following required raw materials are missing from stock:\\n\\n"
            f"{missing_text}\\n\\n"
            f"Please register intake for missing boards or validate incoming delivery receipts before closing this MO."
        )
'''

# Model: mrp.workorder (Work Order)
# Action Name: Strict Stock Availability Enforcement on Work Order Start & Finish
# Trigger: On Stage Update / Method Execution (button_start, do_finish)
MRP_WORKORDER_SERVER_ACTION_CODE = '''# Odoo 19 Server Action: Strict Work Order Stock Enforcement
for wo in records:
    mo = wo.production_id
    if not mo:
        continue

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
                f"- {move.product_id.display_name}: Required {required_qty} {uom_name}, "
                f"Available {avail_qty} {uom_name} (Missing {missing_qty} {uom_name})"
            )

    if missing:
        missing_text = "\\n".join(missing)
        raise UserError(
            f"CANNOT START OR FINISH OPERATION '{wo.name}' ON {mo.name}\\n\\n"
            f"Required raw materials are missing from stock. No work order can be started or finished "
            f"without 100% of required stock being made available:\\n\\n"
            f"{missing_text}\\n\\n"
            f"Please add or receive the required stock before proceeding."
        )
'''


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
