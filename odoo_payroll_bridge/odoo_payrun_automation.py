#!/usr/bin/env python3
"""Validate and optionally process an Odoo Payroll pay run.

This script is intentionally dry-run first. It reads a payslip batch, applies
configurable validation rules, and only calls Odoo workflow methods when
--execute is supplied.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import xmlrpc.client
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_RULES: dict[str, Any] = {
    "models": {
        "payrun": "hr.payslip.run",
        "payslip": "hr.payslip",
        "payslip_line": "hr.payslip.line",
        "payslip_input": "hr.payslip.input",
        "payslip_input_type": "hr.payslip.input.type",
        "salary_structure": "hr.payroll.structure",
        "create_payslips_wizard": "hr.payslip.employees",
        "employee": "hr.employee",
    },
    "payrun_creation": {
        "salary_structure_name": "All",
        "employee_domain": [["active", "=", True]],
        "employee_match_fields": ["name", "identification_id", "work_email", "mobile_phone", "work_phone"],
        "wizard_methods": ["compute_sheet", "action_generate_payslips"],
    },
    "salary_advance": {
        "input_type_name": "Salary Advance",
        "input_type_code": "SALARY_ADVANCE",
        "csv_employee_columns": [
            "employee",
            "employee_name",
            "name",
            "staff_name",
            "employee_id",
            "identification_id",
            "phone",
            "mobile",
            "email",
        ],
        "csv_amount_columns": ["amount", "paid_amount", "advance_amount", "mpesa_amount", "debit", "value"],
        "csv_reference_columns": ["mpesa_receipt", "receipt_no", "transaction_id", "trans_id", "reference"],
        "csv_status_columns": ["status", "transaction_status"],
        "paid_status_values": ["paid", "success", "successful", "completed"],
        "combine_multiple_rows": True,
        "require_positive_amount": True,
    },
    "validations": {
        "require_payslips": True,
        "block_cancelled_slips": True,
        "allowed_slip_states": ["draft", "verify", "done", "paid"],
        "require_unique_employee": True,
        "require_same_period_as_run": True,
        "require_contract": True,
        "require_bank_account": True,
        "employee_bank_account_fields": ["bank_account_id"],
        "required_salary_rule_codes": ["NET"],
        "min_net_wage": 0,
    },
    "actions": {
        "compute_draft_slips": True,
        "validate_slips": True,
        "validate_run": True,
        "compute_states": ["draft", "verify"],
        "skip_validate_states": ["done", "paid", "cancel"],
        "compute_slip_methods": ["compute_sheet"],
        "validate_slip_methods": ["action_payslip_done"],
        "validate_run_methods": ["action_validate", "close_payslip_run"],
    },
}


@dataclass
class Issue:
    severity: str
    subject: str
    message: str


@dataclass
class ActionResult:
    model: str
    record_id: int
    method: str
    status: str
    message: str = ""


@dataclass
class AdvanceRecord:
    employee_keys: list[str]
    amount: float
    references: list[str]
    row_count: int = 1


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_rules(path: Path | None) -> dict[str, Any]:
    if not path:
        return DEFAULT_RULES
    data = json.loads(path.read_text(encoding="utf-8"))
    return deep_merge(DEFAULT_RULES, data)


def as_id(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, (list, tuple)) and value and isinstance(value[0], int):
        return value[0]
    return None


def as_name(value: Any) -> str:
    if isinstance(value, (list, tuple)) and len(value) > 1:
        return str(value[1])
    if value:
        return str(value)
    return ""


def to_float(value: Any) -> float | None:
    if value is None or value is False:
        return None
    try:
        if isinstance(value, str):
            value = re.sub(r"[^\d.\-]", "", value)
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_phone(value: Any) -> list[str]:
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return []
    keys = {digits}
    if digits.startswith("254") and len(digits) >= 12:
        keys.add("0" + digits[-9:])
        keys.add(digits[-9:])
    elif digits.startswith("0") and len(digits) >= 10:
        keys.add("254" + digits[-9:])
        keys.add(digits[-9:])
    elif len(digits) == 9:
        keys.add("254" + digits)
        keys.add("0" + digits)
    return sorted(keys)


def candidate_keys(value: Any) -> list[str]:
    keys = {normalize_key(value)}
    keys.update(normalize_phone(value))
    return [key for key in keys if key]


class OdooClient:
    def __init__(self, url: str, db: str, username: str, password: str) -> None:
        self.url = url.rstrip("/")
        self.db = db
        self.username = username
        self.password = password
        self.common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True)
        self.models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object", allow_none=True)
        self.uid: int | None = None
        self._fields_cache: dict[str, dict[str, Any]] = {}

    def authenticate(self) -> int:
        uid = self.common.authenticate(self.db, self.username, self.password, {})
        if not uid:
            raise RuntimeError("Odoo authentication failed. Check URL, database, user, and API key/password.")
        self.uid = int(uid)
        return self.uid

    def execute(
        self,
        model: str,
        method: str,
        args: list[Any] | None = None,
        kwargs: dict[str, Any] | None = None,
    ) -> Any:
        if self.uid is None:
            self.authenticate()
        return self.models.execute_kw(
            self.db,
            self.uid,
            self.password,
            model,
            method,
            args or [],
            kwargs or {},
        )

    def fields(self, model: str) -> dict[str, Any]:
        if model not in self._fields_cache:
            self._fields_cache[model] = self.execute(
                model,
                "fields_get",
                [],
                {"attributes": ["type", "string"]},
            )
        return self._fields_cache[model]

    def has_field(self, model: str, field: str) -> bool:
        return field in self.fields(model)

    def filter_fields(self, model: str, fields: list[str]) -> list[str]:
        available = self.fields(model)
        return [field for field in fields if field in available]

    def create(self, model: str, values: dict[str, Any], context: dict[str, Any] | None = None) -> int:
        kwargs = {"context": context} if context else {}
        return int(self.execute(model, "create", [values], kwargs))

    def write(
        self,
        model: str,
        ids: list[int],
        values: dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> bool:
        kwargs = {"context": context} if context else {}
        return bool(self.execute(model, "write", [ids, values], kwargs))

    def search(
        self,
        model: str,
        domain: list[Any],
        limit: int | None = None,
        order: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> list[int]:
        kwargs: dict[str, Any] = {}
        if limit is not None:
            kwargs["limit"] = limit
        if order:
            kwargs["order"] = order
        if context:
            kwargs["context"] = context
        return [int(record_id) for record_id in self.execute(model, "search", [domain], kwargs)]

    def search_read(
        self,
        model: str,
        domain: list[Any],
        fields: list[str],
        limit: int | None = None,
        order: str | None = None,
    ) -> list[dict[str, Any]]:
        kwargs: dict[str, Any] = {"fields": self.filter_fields(model, fields)}
        if limit is not None:
            kwargs["limit"] = limit
        if order:
            kwargs["order"] = order
        return self.execute(model, "search_read", [domain], kwargs)

    def read(self, model: str, ids: list[int], fields: list[str]) -> list[dict[str, Any]]:
        if not ids:
            return []
        return self.execute(model, "read", [ids], {"fields": self.filter_fields(model, fields)})


def resolve_payrun(
    client: OdooClient,
    payrun_model: str,
    pay_run_id: int | None,
    pay_run_name: str | None,
) -> dict[str, Any]:
    fields = ["id", "name", "date_start", "date_end", "state", "slip_ids", "company_id"]
    if pay_run_id:
        records = client.read(payrun_model, [pay_run_id], fields)
        if not records:
            raise RuntimeError(f"No pay run found with id {pay_run_id}.")
        return records[0]

    if not pay_run_name:
        raise RuntimeError("Provide --pay-run-id or --pay-run-name.")

    exact = client.search_read(payrun_model, [["name", "=", pay_run_name]], fields, limit=2)
    records = exact or client.search_read(payrun_model, [["name", "ilike", pay_run_name]], fields, limit=2)
    if not records:
        raise RuntimeError(f"No pay run found matching name {pay_run_name!r}.")
    if len(records) > 1:
        names = ", ".join(f"{record['id']}:{record.get('name')}" for record in records)
        raise RuntimeError(f"Pay run name is ambiguous. Use --pay-run-id. Matches: {names}")
    return records[0]


def resolve_salary_structure(client: OdooClient, rules: dict[str, Any], structure_name: str | None) -> int | None:
    if not structure_name or structure_name.strip().lower() == "all":
        return None

    model = rules["models"]["salary_structure"]
    fields = ["id", "name", "code"]
    exact_domain: list[Any]
    if client.has_field(model, "code"):
        exact_domain = ["|", ["name", "=", structure_name], ["code", "=", structure_name]]
    else:
        exact_domain = [["name", "=", structure_name]]
    records = client.search_read(model, exact_domain, fields, limit=2)
    records = records or client.search_read(model, [["name", "ilike", structure_name]], fields, limit=2)
    if not records:
        raise RuntimeError(f"No salary structure found for {structure_name!r}. Use All or a real Odoo structure name.")
    if len(records) > 1:
        matches = ", ".join(f"{record['id']}:{record.get('name')}" for record in records)
        raise RuntimeError(f"Salary structure is ambiguous. Matches: {matches}")
    return int(records[0]["id"])


def create_payrun(
    client: OdooClient,
    rules: dict[str, Any],
    name: str,
    date_start: str,
    date_end: str,
    salary_structure_name: str | None,
) -> tuple[dict[str, Any], list[ActionResult]]:
    model = rules["models"]["payrun"]
    fields = client.fields(model)
    values: dict[str, Any] = {"name": name}
    if "date_start" in fields:
        values["date_start"] = date_start
    if "date_end" in fields:
        values["date_end"] = date_end

    structure_id = resolve_salary_structure(client, rules, salary_structure_name)
    if structure_id:
        for field in ("struct_id", "structure_id"):
            if field in fields:
                values[field] = structure_id
                break

    run_id = client.create(model, values)
    run = resolve_payrun(client, model, run_id, None)
    action = ActionResult(model, run_id, "create", "ok", f"Created pay run {name} for {date_start} to {date_end}.")
    return run, [action]


def employee_domain_from_args(args: argparse.Namespace, rules: dict[str, Any]) -> list[Any]:
    if args.employee_domain_json:
        domain = json.loads(args.employee_domain_json)
        if not isinstance(domain, list):
            raise RuntimeError("--employee-domain-json must be a JSON list.")
        return domain
    return list(rules["payrun_creation"].get("employee_domain") or [])


def select_employee_ids(client: OdooClient, rules: dict[str, Any], domain: list[Any]) -> list[int]:
    return client.search(rules["models"]["employee"], domain, order="name asc")


def create_payslips_for_payrun(
    client: OdooClient,
    rules: dict[str, Any],
    run: dict[str, Any],
    employee_ids: list[int],
    salary_structure_name: str | None,
) -> list[ActionResult]:
    if not employee_ids:
        return [ActionResult(rules["models"]["employee"], 0, "search", "failed", "No employees matched the configured domain.")]

    payrun_model = rules["models"]["payrun"]
    wizard_model = rules["models"]["create_payslips_wizard"]
    wizard_fields = client.fields(wizard_model)
    context = {"active_model": payrun_model, "active_id": int(run["id"]), "active_ids": [int(run["id"])]}

    values: dict[str, Any] = {}
    if "employee_ids" in wizard_fields:
        values["employee_ids"] = [[6, 0, employee_ids]]

    structure_id = resolve_salary_structure(client, rules, salary_structure_name)
    if structure_id:
        for field in ("structure_id", "struct_id"):
            if field in wizard_fields:
                values[field] = structure_id
                break

    wizard_id = client.create(wizard_model, values, context=context)
    last_error = ""
    for method in rules["payrun_creation"].get("wizard_methods") or ["compute_sheet"]:
        try:
            client.execute(wizard_model, method, [[wizard_id]], {"context": context})
            return [
                ActionResult(
                    wizard_model,
                    wizard_id,
                    method,
                    "ok",
                    f"Created draft payslips for {len(employee_ids)} employee(s).",
                )
            ]
        except Exception as exc:
            last_error = str(exc)
            if looks_like_missing_method(exc):
                continue
            return [ActionResult(wizard_model, wizard_id, method, "failed", last_error)]
    return [ActionResult(wizard_model, wizard_id, ",".join(rules["payrun_creation"].get("wizard_methods") or []), "failed", last_error)]


def read_payslips(
    client: OdooClient,
    run: dict[str, Any],
    payrun_model: str,
    payslip_model: str,
) -> list[dict[str, Any]]:
    slip_fields = [
        "id",
        "number",
        "name",
        "employee_id",
        "state",
        "date_from",
        "date_to",
        "contract_id",
        "company_id",
        "currency_id",
        "move_id",
        "line_ids",
        "net_wage",
    ]

    slip_ids = run.get("slip_ids") if client.has_field(payrun_model, "slip_ids") else None
    if isinstance(slip_ids, list) and slip_ids:
        return client.read(payslip_model, slip_ids, slip_fields)

    for field in ("payslip_run_id", "run_id", "batch_id"):
        if client.has_field(payslip_model, field):
            return client.search_read(payslip_model, [[field, "=", run["id"]]], slip_fields, order="id asc")

    raise RuntimeError("Could not locate payslips for the pay run. Add the batch relation field to the script.")


def column_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def row_value(row: dict[str, Any], configured_columns: list[str]) -> Any:
    keyed = {column_key(str(key)): value for key, value in row.items()}
    for column in configured_columns:
        value = keyed.get(column_key(column))
        if value not in (None, ""):
            return value
    return None


def load_table_records(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            for key in ("records", "data", "rows", "transactions"):
                if isinstance(data.get(key), list):
                    data = data[key]
                    break
        if not isinstance(data, list):
            raise RuntimeError("Advance JSON must be a list, or an object containing records/data/rows/transactions.")
        return [record for record in data if isinstance(record, dict)]

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def advance_records_from_rows(
    records: list[dict[str, Any]],
    rules: dict[str, Any],
    start_index: int = 2,
) -> tuple[list[AdvanceRecord], list[Issue]]:
    config = rules["salary_advance"]
    issues: list[Issue] = []
    paid_values = {normalize_key(value) for value in config.get("paid_status_values") or []}
    advances: list[AdvanceRecord] = []

    for index, row in enumerate(records, start=start_index):
        status = row_value(row, config.get("csv_status_columns") or [])
        if status and paid_values and normalize_key(status) not in paid_values:
            continue

        amount = to_float(row_value(row, config.get("csv_amount_columns") or []))
        if amount is None:
            issues.append(Issue("WARN", f"advance-row:{index}", "Skipped row because no amount column was found."))
            continue
        if config.get("require_positive_amount", True) and amount <= 0:
            issues.append(Issue("WARN", f"advance-row:{index}", f"Skipped non-positive advance amount {amount:.2f}."))
            continue

        keys: list[str] = []
        for column in config.get("csv_employee_columns") or []:
            value = row_value(row, [column])
            keys.extend(candidate_keys(value))
        keys = sorted(set(keys))
        if not keys:
            issues.append(Issue("WARN", f"advance-row:{index}", "Skipped row because no employee identifier was found."))
            continue

        reference = row_value(row, config.get("csv_reference_columns") or [])
        advances.append(AdvanceRecord(keys, amount, [str(reference)] if reference else [], 1))

    return advances, issues


def load_advances(path: Path, rules: dict[str, Any]) -> tuple[list[AdvanceRecord], list[Issue]]:
    records = load_table_records(path)
    return advance_records_from_rows(records, rules)


def combine_advances(records: list[AdvanceRecord]) -> AdvanceRecord:
    keys: set[str] = set()
    references: list[str] = []
    amount = 0.0
    row_count = 0
    for record in records:
        keys.update(record.employee_keys)
        references.extend(record.references)
        amount += record.amount
        row_count += record.row_count
    return AdvanceRecord(sorted(keys), amount, sorted(set(references)), row_count)


def employee_key_index(employees: list[dict[str, Any]], match_fields: list[str]) -> dict[str, set[int]]:
    index: dict[str, set[int]] = {}
    for employee in employees:
        employee_id = int(employee["id"])
        for field in match_fields:
            value = employee.get(field)
            if isinstance(value, (list, tuple)):
                value = value[1] if len(value) > 1 else value[0]
            for key in candidate_keys(value):
                index.setdefault(key, set()).add(employee_id)
    return index


def match_advances_to_employees(
    advances: list[AdvanceRecord],
    employees: list[dict[str, Any]],
    match_fields: list[str],
) -> tuple[dict[int, AdvanceRecord], list[Issue]]:
    issues: list[Issue] = []
    index = employee_key_index(employees, match_fields)
    by_employee: dict[int, list[AdvanceRecord]] = {}

    for record in advances:
        matched_ids: set[int] = set()
        for key in record.employee_keys:
            matched_ids.update(index.get(key, set()))
        if not matched_ids:
            keys = ", ".join(record.employee_keys[:3])
            issues.append(Issue("WARN", "salary-advance", f"Could not match advance amount {record.amount:.2f} to an employee using {keys}."))
            continue
        if len(matched_ids) > 1:
            issues.append(
                Issue(
                    "WARN",
                    "salary-advance",
                    f"Advance amount {record.amount:.2f} matched multiple employees {sorted(matched_ids)} and was skipped.",
                )
            )
            continue
        employee_id = next(iter(matched_ids))
        by_employee.setdefault(employee_id, []).append(record)

    return {employee_id: combine_advances(records) for employee_id, records in by_employee.items()}, issues


def resolve_salary_input_type(client: OdooClient, rules: dict[str, Any]) -> int | None:
    model = rules["models"]["payslip_input_type"]
    config = rules["salary_advance"]
    fields = client.fields(model)
    name = config.get("input_type_name") or "Salary Advance"
    code = config.get("input_type_code") or "SALARY_ADVANCE"

    domains: list[list[Any]] = []
    if "code" in fields:
        domains.append([["code", "=", code]])
    if "name" in fields:
        domains.append([["name", "=", name]])
        domains.append([["name", "ilike", name]])

    for domain in domains:
        records = client.search_read(model, domain, ["id", "name", "code"], limit=2)
        if len(records) == 1:
            return int(records[0]["id"])
        if len(records) > 1:
            matches = ", ".join(f"{record['id']}:{record.get('name')}" for record in records)
            raise RuntimeError(f"Salary Advance input type is ambiguous. Matches: {matches}")
    return None


def salary_input_domain(
    input_fields: dict[str, Any],
    slip_id: int,
    input_type_id: int | None,
    rules: dict[str, Any],
) -> tuple[list[Any], str]:
    slip_field = next((field for field in ("payslip_id", "slip_id") if field in input_fields), "")
    if not slip_field:
        raise RuntimeError("Could not find payslip relation field on hr.payslip.input.")

    domain: list[Any] = [[slip_field, "=", slip_id]]
    config = rules["salary_advance"]
    if input_type_id and "input_type_id" in input_fields:
        domain.append(["input_type_id", "=", input_type_id])
    elif "code" in input_fields:
        domain.append(["code", "=", config.get("input_type_code") or "SALARY_ADVANCE"])
    elif "name" in input_fields:
        domain.append(["name", "ilike", config.get("input_type_name") or "Salary Advance"])
    return domain, slip_field


def salary_input_values(
    input_fields: dict[str, Any],
    slip: dict[str, Any],
    amount: float,
    input_type_id: int | None,
    advance: AdvanceRecord,
    rules: dict[str, Any],
) -> dict[str, Any]:
    config = rules["salary_advance"]
    values: dict[str, Any] = {"amount": amount}
    if "input_type_id" in input_fields:
        if not input_type_id:
            raise RuntimeError("No Salary Advance input type was found in Odoo.")
        values["input_type_id"] = input_type_id
    if "code" in input_fields:
        values["code"] = config.get("input_type_code") or "SALARY_ADVANCE"
    if "name" in input_fields:
        ref_text = ", ".join(advance.references[:3])
        values["name"] = f"M-Pesa salary advance{f' ({ref_text})' if ref_text else ''}"
    if "contract_id" in input_fields:
        contract_id = as_id(slip.get("contract_id"))
        if contract_id:
            values["contract_id"] = contract_id
    return values


def apply_salary_advances(
    client: OdooClient,
    rules: dict[str, Any],
    slips: list[dict[str, Any]],
    advance_file: Path | None,
    execute: bool,
) -> tuple[list[ActionResult], list[Issue]]:
    if not advance_file:
        return [], []

    advances, issues = load_advances(advance_file, rules)
    if not advances:
        issues.append(Issue("WARN", "salary-advance", f"No usable salary advances were loaded from {advance_file}."))
        return [], issues

    return apply_salary_advance_records(client, rules, slips, advances, execute, issues)


def apply_salary_advance_records(
    client: OdooClient,
    rules: dict[str, Any],
    slips: list[dict[str, Any]],
    advances: list[AdvanceRecord],
    execute: bool,
    issues: list[Issue] | None = None,
) -> tuple[list[ActionResult], list[Issue]]:
    issues = list(issues or [])
    employee_ids = sorted({as_id(slip.get("employee_id")) for slip in slips if as_id(slip.get("employee_id"))})
    match_fields = list(rules["payrun_creation"].get("employee_match_fields") or ["name"])
    employee_fields = ["id", *match_fields]
    employees = client.read(rules["models"]["employee"], [employee_id for employee_id in employee_ids if employee_id], employee_fields)
    matched, match_issues = match_advances_to_employees(advances, employees, match_fields)
    issues.extend(match_issues)

    slips_by_employee = {as_id(slip.get("employee_id")): slip for slip in slips if as_id(slip.get("employee_id"))}
    actions: list[ActionResult] = []
    if not matched:
        return actions, issues

    input_model = rules["models"]["payslip_input"]
    input_fields = client.fields(input_model) if execute else {}
    input_type_id = resolve_salary_input_type(client, rules) if execute and "input_type_id" in input_fields else None

    for employee_id, advance in matched.items():
        slip = slips_by_employee.get(employee_id)
        if not slip:
            issues.append(Issue("WARN", f"employee:{employee_id}", f"Matched salary advance {advance.amount:.2f}, but no payslip exists in this run."))
            continue

        slip_id = int(slip["id"])
        if str(slip.get("state") or "") != "draft":
            issues.append(Issue("ERROR", f"payslip:{slip_id}", "Salary Advance can only be inserted while the payslip is in Draft."))
            actions.append(ActionResult(input_model, slip_id, "salary_advance", "failed", f"Skipped amount {advance.amount:.2f}."))
            continue

        if not execute:
            actions.append(ActionResult(input_model, slip_id, "salary_advance", "planned", f"Would set Salary Advance to {advance.amount:.2f}."))
            continue

        domain, slip_field = salary_input_domain(input_fields, slip_id, input_type_id, rules)
        values = salary_input_values(input_fields, slip, advance.amount, input_type_id, advance, rules)
        values[slip_field] = slip_id
        existing_ids = client.search(input_model, domain, limit=1)
        if existing_ids:
            client.write(input_model, existing_ids, values)
            actions.append(ActionResult(input_model, existing_ids[0], "write", "ok", f"Updated Salary Advance to {advance.amount:.2f}."))
        else:
            record_id = client.create(input_model, values)
            actions.append(ActionResult(input_model, record_id, "create", "ok", f"Added Salary Advance {advance.amount:.2f}."))

    return actions, issues


def enrich_salary_lines(
    client: OdooClient,
    slips: list[dict[str, Any]],
    payslip_line_model: str,
) -> dict[int, list[dict[str, Any]]]:
    line_ids: list[int] = []
    for slip in slips:
        ids = slip.get("line_ids")
        if isinstance(ids, list):
            line_ids.extend(int(line_id) for line_id in ids)

    if not line_ids:
        return {}

    line_fields = ["id", "slip_id", "code", "name", "total", "amount"]
    try:
        lines = client.read(payslip_line_model, line_ids, line_fields)
    except Exception:
        return {}

    by_slip: dict[int, list[dict[str, Any]]] = {}
    for line in lines:
        slip_id = as_id(line.get("slip_id"))
        if slip_id is not None:
            by_slip.setdefault(slip_id, []).append(line)
    return by_slip


def net_amount(slip: dict[str, Any], lines_by_slip: dict[int, list[dict[str, Any]]]) -> float | None:
    direct = to_float(slip.get("net_wage"))
    if direct is not None:
        return direct

    for line in lines_by_slip.get(int(slip["id"]), []):
        if str(line.get("code", "")).upper() == "NET":
            return to_float(line.get("total")) or to_float(line.get("amount"))
    return None


def read_employees(
    client: OdooClient,
    slips: list[dict[str, Any]],
    employee_model: str,
    bank_fields: list[str],
) -> dict[int, dict[str, Any]]:
    employee_ids = sorted({as_id(slip.get("employee_id")) for slip in slips if as_id(slip.get("employee_id"))})
    fields = ["id", "name", *bank_fields]
    records = client.read(employee_model, [employee_id for employee_id in employee_ids if employee_id], fields)
    return {int(record["id"]): record for record in records}


def validate(
    client: OdooClient,
    rules: dict[str, Any],
    run: dict[str, Any],
    slips: list[dict[str, Any]],
) -> tuple[list[Issue], dict[int, float | None]]:
    validations = rules["validations"]
    models = rules["models"]
    issues: list[Issue] = []
    net_by_slip: dict[int, float | None] = {}

    if validations.get("require_payslips") and not slips:
        issues.append(Issue("ERROR", f"payrun:{run['id']}", "Pay run has no payslips."))
        return issues, net_by_slip

    lines_by_slip = enrich_salary_lines(client, slips, models["payslip_line"])
    bank_fields = list(validations.get("employee_bank_account_fields") or [])
    employees = read_employees(client, slips, models["employee"], bank_fields) if bank_fields else {}

    seen_employee_slips: dict[int, int] = {}
    allowed_states = set(validations.get("allowed_slip_states") or [])
    required_codes = {str(code).upper() for code in validations.get("required_salary_rule_codes") or []}
    min_net_wage = validations.get("min_net_wage")

    for slip in slips:
        slip_id = int(slip["id"])
        subject = f"payslip:{slip_id}"
        state = str(slip.get("state") or "")

        if validations.get("block_cancelled_slips") and state == "cancel":
            issues.append(Issue("ERROR", subject, "Payslip is cancelled."))
        if allowed_states and state not in allowed_states:
            issues.append(Issue("ERROR", subject, f"Payslip state {state!r} is not allowed."))

        employee_id = as_id(slip.get("employee_id"))
        if not employee_id:
            issues.append(Issue("ERROR", subject, "Payslip has no employee."))
        elif validations.get("require_unique_employee"):
            previous = seen_employee_slips.get(employee_id)
            if previous:
                employee_name = as_name(slip.get("employee_id"))
                issues.append(
                    Issue(
                        "ERROR",
                        subject,
                        f"Employee {employee_name or employee_id} appears in both payslip {previous} and {slip_id}.",
                    )
                )
            seen_employee_slips[employee_id] = slip_id

        if validations.get("require_contract") and client.has_field(models["payslip"], "contract_id"):
            if not as_id(slip.get("contract_id")):
                issues.append(Issue("ERROR", subject, "Payslip has no contract."))

        if validations.get("require_bank_account") and employee_id:
            employee = employees.get(employee_id, {})
            has_bank = any(bool(employee.get(field)) for field in bank_fields)
            if bank_fields and not has_bank:
                issues.append(Issue("ERROR", subject, "Employee is missing a configured bank account field."))

        if validations.get("require_same_period_as_run"):
            run_start = run.get("date_start")
            run_end = run.get("date_end")
            slip_start = slip.get("date_from")
            slip_end = slip.get("date_to")
            if run_start and slip_start and run_start != slip_start:
                issues.append(Issue("ERROR", subject, f"Payslip start {slip_start} does not match pay run {run_start}."))
            if run_end and slip_end and run_end != slip_end:
                issues.append(Issue("ERROR", subject, f"Payslip end {slip_end} does not match pay run {run_end}."))

        slip_lines = lines_by_slip.get(slip_id, [])
        line_codes = {str(line.get("code", "")).upper() for line in slip_lines}
        if required_codes and not slip_lines:
            issues.append(Issue("WARN", subject, "Salary lines were not available, so required salary rule codes were not verified."))
        for code in required_codes:
            if slip_lines and code not in line_codes:
                issues.append(Issue("ERROR", subject, f"Required salary rule code {code!r} was not found."))

        amount = net_amount(slip, lines_by_slip)
        net_by_slip[slip_id] = amount
        if amount is None:
            issues.append(Issue("WARN", subject, "Net wage could not be determined from net_wage or NET salary line."))
        elif min_net_wage is not None and amount < float(min_net_wage):
            issues.append(Issue("ERROR", subject, f"Net wage {amount:.2f} is below minimum {float(min_net_wage):.2f}."))

        if state == "done" and client.has_field(models["payslip"], "move_id") and not as_id(slip.get("move_id")):
            issues.append(Issue("WARN", subject, "Payslip is done but has no accounting move."))

    return issues, net_by_slip


def looks_like_missing_method(error: Exception) -> bool:
    text = str(error).lower()
    fragments = [
        "has no attribute",
        "object has no attribute",
        "unknown method",
        "method not found",
        "not a valid action",
    ]
    return any(fragment in text for fragment in fragments)


def call_first_available(
    client: OdooClient,
    model: str,
    record_id: int,
    methods: list[str],
) -> ActionResult:
    last_error = ""
    for method in methods:
        try:
            client.execute(model, method, [[record_id]])
            return ActionResult(model, record_id, method, "ok")
        except Exception as exc:
            last_error = str(exc)
            if looks_like_missing_method(exc):
                continue
            return ActionResult(model, record_id, method, "failed", last_error)
    return ActionResult(model, record_id, ",".join(methods), "failed", last_error or "No configured method succeeded.")


def execute_actions(
    client: OdooClient,
    rules: dict[str, Any],
    run: dict[str, Any],
    slips: list[dict[str, Any]],
) -> list[ActionResult]:
    actions = rules["actions"]
    models = rules["models"]
    results: list[ActionResult] = []

    if actions.get("compute_draft_slips"):
        compute_states = set(actions.get("compute_states") or [])
        compute_ids = [int(slip["id"]) for slip in slips if str(slip.get("state") or "") in compute_states]
        for slip_id in compute_ids:
            results.append(call_first_available(client, models["payslip"], slip_id, actions["compute_slip_methods"]))

    if actions.get("validate_slips"):
        skip_states = set(actions.get("skip_validate_states") or [])
        validate_ids = [int(slip["id"]) for slip in slips if str(slip.get("state") or "") not in skip_states]
        for slip_id in validate_ids:
            results.append(call_first_available(client, models["payslip"], slip_id, actions["validate_slip_methods"]))

    if actions.get("validate_run"):
        results.append(call_first_available(client, models["payrun"], int(run["id"]), actions["validate_run_methods"]))

    return results


def print_text_report(
    run: dict[str, Any],
    slips: list[dict[str, Any]],
    issues: list[Issue],
    net_by_slip: dict[int, float | None],
    actions: list[ActionResult],
    execute: bool,
) -> None:
    errors = [issue for issue in issues if issue.severity == "ERROR"]
    warnings = [issue for issue in issues if issue.severity == "WARN"]
    print(f"Pay run: {run.get('name')} (id={run.get('id')}, state={run.get('state', 'unknown')})")
    print(f"Payslips: {len(slips)}")
    print(f"Mode: {'EXECUTE' if execute else 'DRY RUN'}")
    print(f"Validation: {len(errors)} error(s), {len(warnings)} warning(s)")

    if slips:
        total_net = sum(amount for amount in net_by_slip.values() if amount is not None)
        known_net_count = sum(1 for amount in net_by_slip.values() if amount is not None)
        print(f"Known net total: {total_net:.2f} across {known_net_count} payslip(s)")

    if issues:
        print("\nIssues")
        for issue in issues:
            print(f"- [{issue.severity}] {issue.subject}: {issue.message}")

    if actions:
        print("\nActions")
        for result in actions:
            detail = f" - {result.message}" if result.message else ""
            print(f"- [{result.status.upper()}] {result.model}:{result.record_id} via {result.method}{detail}")


def write_json_report(
    path: Path,
    run: dict[str, Any],
    slips: list[dict[str, Any]],
    issues: list[Issue],
    net_by_slip: dict[int, float | None],
    actions: list[ActionResult],
    execute: bool,
) -> None:
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "execute" if execute else "dry_run",
        "pay_run": run,
        "payslip_count": len(slips),
        "net_by_payslip": net_by_slip,
        "issues": [asdict(issue) for issue in issues],
        "actions": [asdict(action) for action in actions],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and optionally process an Odoo Payroll pay run.")
    parser.add_argument("--env-file", default=".env", help="Path to .env file. Defaults to .env.")
    parser.add_argument("--rules", default="payrun_rules.example.json", help="Validation/action rules JSON file.")
    parser.add_argument("--url", default=os.environ.get("ODOO_URL") or os.environ.get("ODOO_BASE_URL"), help="Odoo base URL.")
    parser.add_argument("--db", default=os.environ.get("ODOO_DB") or os.environ.get("ODOO_DATABASE"), help="Odoo database name.")
    parser.add_argument("--username", default=os.environ.get("ODOO_USERNAME"), help="Odoo username/login.")
    parser.add_argument("--password", default=os.environ.get("ODOO_PASSWORD") or os.environ.get("ODOO_API_KEY"), help="Odoo password or API key.")
    parser.add_argument("--pay-run-id", type=int, help="Odoo hr.payslip.run id.")
    parser.add_argument("--pay-run-name", help="Odoo pay run name. Use --pay-run-id if the name is ambiguous.")
    parser.add_argument("--create-pay-run", action="store_true", help="Create a new pay run and draft payslips before validation.")
    parser.add_argument("--date-start", help="New pay run start date, for example 2026-05-01.")
    parser.add_argument("--date-end", help="New pay run end date, for example 2026-05-31.")
    parser.add_argument("--salary-structure", help="Salary structure for payslip generation. Defaults to rules value, usually All.")
    parser.add_argument("--employee-domain-json", help="Optional Odoo domain JSON for employees. Defaults to active employees.")
    parser.add_argument("--advance-file", help="CSV or JSON export from reconciler.flowcode.co.ke containing M-Pesa salary advances.")
    parser.add_argument("--execute", action="store_true", help="Actually call configured Odoo workflow methods.")
    parser.add_argument("--report", help="Optional JSON report output path.")
    return parser.parse_args()


def print_create_preview(
    args: argparse.Namespace,
    rules: dict[str, Any],
    employee_count: int,
    advances: list[AdvanceRecord],
    issues: list[Issue],
) -> None:
    structure = args.salary_structure or rules["payrun_creation"].get("salary_structure_name") or "All"
    total_advance = sum(record.amount for record in advances)
    print("Mode: DRY RUN")
    print(f"Would create pay run: {args.pay_run_name}")
    print(f"Period: {args.date_start} to {args.date_end}")
    print(f"Salary structure selector: {structure}")
    print(f"Employees selected: {employee_count}")
    if args.advance_file:
        print(f"Advance rows loaded: {len(advances)}")
        print(f"Advance total: {total_advance:.2f}")
    if issues:
        print("\nIssues")
        for issue in issues:
            print(f"- [{issue.severity}] {issue.subject}: {issue.message}")
    print("\nAdd --execute to create the pay run, create draft payslips, and insert Salary Advance inputs.")


def main() -> int:
    args = parse_args()
    load_env_file(Path(args.env_file))

    url = args.url or os.environ.get("ODOO_URL") or os.environ.get("ODOO_BASE_URL")
    db = args.db or os.environ.get("ODOO_DB") or os.environ.get("ODOO_DATABASE")
    username = args.username or os.environ.get("ODOO_USERNAME")
    password = args.password or os.environ.get("ODOO_PASSWORD") or os.environ.get("ODOO_API_KEY")

    missing = [name for name, value in {"ODOO_URL": url, "ODOO_DB": db, "ODOO_USERNAME": username, "ODOO_PASSWORD/API_KEY": password}.items() if not value]
    if missing:
        print(f"Missing required connection setting(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    rules_path = Path(args.rules) if args.rules else None
    rules = load_rules(rules_path)
    client = OdooClient(str(url), str(db), str(username), str(password))
    advance_file = Path(args.advance_file) if args.advance_file else None
    if advance_file and not advance_file.exists():
        print(f"Advance file does not exist: {advance_file}", file=sys.stderr)
        return 1

    try:
        client.authenticate()
        actions: list[ActionResult] = []
        issues: list[Issue] = []

        if args.create_pay_run:
            if not args.pay_run_name or not args.date_start or not args.date_end:
                raise RuntimeError("--create-pay-run requires --pay-run-name, --date-start, and --date-end.")
            salary_structure = args.salary_structure or rules["payrun_creation"].get("salary_structure_name") or "All"
            employee_domain = employee_domain_from_args(args, rules)
            employee_ids = select_employee_ids(client, rules, employee_domain)

            if not args.execute:
                advances: list[AdvanceRecord] = []
                if advance_file:
                    advances, issues = load_advances(advance_file, rules)
                print_create_preview(args, rules, len(employee_ids), advances, issues)
                return 2 if any(issue.severity == "ERROR" for issue in issues) else 0

            run, create_actions = create_payrun(client, rules, args.pay_run_name, args.date_start, args.date_end, salary_structure)
            actions.extend(create_actions)
            actions.extend(create_payslips_for_payrun(client, rules, run, employee_ids, salary_structure))
            for action in actions:
                if action.status == "failed":
                    issues.append(Issue("ERROR", f"{action.model}:{action.record_id}", action.message or f"{action.method} failed."))
            run = resolve_payrun(client, rules["models"]["payrun"], int(run["id"]), None)
        else:
            run = resolve_payrun(client, rules["models"]["payrun"], args.pay_run_id, args.pay_run_name)

        slips = read_payslips(client, run, rules["models"]["payrun"], rules["models"]["payslip"])
        advance_actions, advance_issues = apply_salary_advances(client, rules, slips, advance_file, args.execute)
        actions.extend(advance_actions)
        issues.extend(advance_issues)
        for action in advance_actions:
            if action.status == "failed":
                issues.append(Issue("ERROR", f"{action.model}:{action.record_id}", action.message or f"{action.method} failed."))

        if args.execute and advance_actions:
            run = resolve_payrun(client, rules["models"]["payrun"], int(run["id"]), None)
            slips = read_payslips(client, run, rules["models"]["payrun"], rules["models"]["payslip"])

        validation_issues, net_by_slip = validate(client, rules, run, slips)
        issues.extend(validation_issues)

        error_count = sum(1 for issue in issues if issue.severity == "ERROR")
        if args.execute and error_count == 0:
            actions.extend(execute_actions(client, rules, run, slips))
            failed_actions = [action for action in actions if action.status != "ok"]
            for action in failed_actions:
                if action.status == "planned":
                    continue
                issues.append(Issue("ERROR", f"{action.model}:{action.record_id}", f"Action {action.method} failed: {action.message}"))
        elif args.execute and error_count:
            issues.append(Issue("ERROR", f"payrun:{run['id']}", "Execution skipped because validation errors exist."))

        print_text_report(run, slips, issues, net_by_slip, actions, args.execute)
        if args.report:
            write_json_report(Path(args.report), run, slips, issues, net_by_slip, actions, args.execute)
            print(f"\nJSON report written to {args.report}")

        return 2 if any(issue.severity == "ERROR" for issue in issues) else 0
    except Exception as exc:
        print(f"Failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
