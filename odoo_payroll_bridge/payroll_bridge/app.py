from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

import odoo_payrun_automation as payroll


WORKSPACE = Path(__file__).resolve().parent.parent
payroll.load_env_file(Path(os.environ.get("ENV_FILE", WORKSPACE / ".env")))


def normalize_prefix(value: Optional[str]) -> str:
    prefix = "/odoo-payroll" if value is None else value.strip()
    if not prefix or prefix == "/":
        return ""
    return "/" + prefix.strip("/")


PATH_PREFIX = normalize_prefix(os.environ.get("PAYROLL_SERVICE_PATH_PREFIX"))
DB_PATH = Path(os.environ.get("ADVANCE_DB_PATH", WORKSPACE / "data" / "payroll_bridge.sqlite"))
RULES_PATH = Path(os.environ.get("PAYROLL_RULES_PATH", WORKSPACE / "payrun_rules.example.json"))


class AdvancePayload(BaseModel):
    employee_name: Optional[str] = None
    employee_id: Optional[str] = None
    identification_id: Optional[str] = None
    phone: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    amount: float
    mpesa_receipt: Optional[str] = None
    reference: Optional[str] = None
    status: str = "Completed"
    transaction_date: Optional[str] = None
    raw: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class AdvanceBatchPayload(BaseModel):
    period_start: str
    period_end: str
    source: str = "reconciler.flowcode.co.ke"
    records: List[AdvancePayload]


class OdooCredentialsPayload(BaseModel):
    base_url: Optional[str] = None
    database: Optional[str] = None
    username: Optional[str] = None
    api_key: Optional[str] = None


class PayRunPayload(BaseModel):
    pay_run_name: str
    date_start: str
    date_end: str
    salary_structure: str = "All"
    employee_domain: Optional[List[Any]] = None
    confirm_execute: bool = False
    odoo_credentials: Optional[OdooCredentialsPayload] = None


class AdvanceStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.ensure_schema()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def ensure_schema(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS salary_advances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    period_start TEXT NOT NULL,
                    period_end TEXT NOT NULL,
                    source TEXT NOT NULL,
                    dedupe_key TEXT NOT NULL,
                    employee_name TEXT,
                    employee_id TEXT,
                    identification_id TEXT,
                    phone TEXT,
                    mobile TEXT,
                    email TEXT,
                    amount REAL NOT NULL,
                    mpesa_receipt TEXT,
                    reference TEXT,
                    status TEXT,
                    transaction_date TEXT,
                    raw_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(period_start, period_end, source, dedupe_key)
                )
                """
            )

    def upsert_batch(self, payload: AdvanceBatchPayload) -> Dict[str, int]:
        inserted = 0
        updated = 0
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            for record in payload.records:
                row = advance_to_row(payload, record, now)
                before = conn.total_changes
                conn.execute(
                    """
                    INSERT INTO salary_advances (
                        period_start, period_end, source, dedupe_key,
                        employee_name, employee_id, identification_id, phone, mobile, email,
                        amount, mpesa_receipt, reference, status, transaction_date, raw_json,
                        created_at, updated_at
                    )
                    VALUES (
                        :period_start, :period_end, :source, :dedupe_key,
                        :employee_name, :employee_id, :identification_id, :phone, :mobile, :email,
                        :amount, :mpesa_receipt, :reference, :status, :transaction_date, :raw_json,
                        :created_at, :updated_at
                    )
                    ON CONFLICT(period_start, period_end, source, dedupe_key)
                    DO UPDATE SET
                        employee_name = excluded.employee_name,
                        employee_id = excluded.employee_id,
                        identification_id = excluded.identification_id,
                        phone = excluded.phone,
                        mobile = excluded.mobile,
                        email = excluded.email,
                        amount = excluded.amount,
                        mpesa_receipt = excluded.mpesa_receipt,
                        reference = excluded.reference,
                        status = excluded.status,
                        transaction_date = excluded.transaction_date,
                        raw_json = excluded.raw_json,
                        updated_at = excluded.updated_at
                    """,
                    row,
                )
                if conn.total_changes == before + 1:
                    existing = conn.execute(
                        """
                        SELECT created_at, updated_at
                        FROM salary_advances
                        WHERE period_start = ? AND period_end = ? AND source = ? AND dedupe_key = ?
                        """,
                        (payload.period_start, payload.period_end, payload.source, row["dedupe_key"]),
                    ).fetchone()
                    if existing and existing["created_at"] == existing["updated_at"]:
                        inserted += 1
                    else:
                        updated += 1
        return {"inserted": inserted, "updated": updated, "received": len(payload.records)}

    def records_for_period(self, period_start: str, period_end: str) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM salary_advances
                WHERE period_start = ? AND period_end = ?
                ORDER BY transaction_date, id
                """,
                (period_start, period_end),
            ).fetchall()
        return [dict(row) for row in rows]


def public_model_dump(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def advance_to_row(batch: AdvanceBatchPayload, record: AdvancePayload, now: str) -> Dict[str, Any]:
    data = public_model_dump(record)
    reference = data.get("reference") or data.get("mpesa_receipt") or ""
    dedupe_source = {
        "reference": reference,
        "employee_name": data.get("employee_name"),
        "employee_id": data.get("employee_id"),
        "phone": data.get("phone") or data.get("mobile"),
        "amount": data.get("amount"),
        "transaction_date": data.get("transaction_date"),
    }
    dedupe_key = hashlib.sha256(json.dumps(dedupe_source, sort_keys=True, default=str).encode("utf-8")).hexdigest()
    return {
        "period_start": batch.period_start,
        "period_end": batch.period_end,
        "source": batch.source,
        "dedupe_key": dedupe_key,
        "employee_name": data.get("employee_name"),
        "employee_id": data.get("employee_id"),
        "identification_id": data.get("identification_id"),
        "phone": data.get("phone"),
        "mobile": data.get("mobile"),
        "email": data.get("email"),
        "amount": float(data["amount"]),
        "mpesa_receipt": data.get("mpesa_receipt"),
        "reference": reference,
        "status": data.get("status") or "Completed",
        "transaction_date": data.get("transaction_date"),
        "raw_json": json.dumps(data.get("raw") or data, default=str),
        "created_at": now,
        "updated_at": now,
    }


def get_store() -> AdvanceStore:
    return AdvanceStore(DB_PATH)


def require_token(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
) -> None:
    expected = os.environ.get("PAYROLL_BRIDGE_TOKEN")
    if not expected:
        raise HTTPException(status_code=500, detail="PAYROLL_BRIDGE_TOKEN is not configured.")
    bearer = f"Bearer {expected}"
    if authorization == bearer or x_api_key == expected:
        return
    raise HTTPException(status_code=401, detail="Invalid or missing bridge token.")


def load_rules() -> Dict[str, Any]:
    return payroll.load_rules(RULES_PATH)


def make_odoo_client(credentials: Optional[OdooCredentialsPayload] = None) -> payroll.OdooClient:
    url = (credentials.base_url if credentials else None) or os.environ.get("ODOO_URL") or os.environ.get("ODOO_BASE_URL")
    db = (credentials.database if credentials else None) or os.environ.get("ODOO_DB") or os.environ.get("ODOO_DATABASE")
    username = (credentials.username if credentials else None) or os.environ.get("ODOO_USERNAME")
    password = (credentials.api_key if credentials else None) or os.environ.get("ODOO_PASSWORD") or os.environ.get("ODOO_API_KEY")
    missing = [name for name, value in {"ODOO_URL": url, "ODOO_DB": db, "ODOO_USERNAME": username, "ODOO_PASSWORD/API_KEY": password}.items() if not value]
    if missing:
        raise HTTPException(status_code=500, detail=f"Missing Odoo setting(s): {', '.join(missing)}")
    client = payroll.OdooClient(str(url), str(db), str(username), str(password))
    client.authenticate()
    return client


def advance_rows_for_period(period_start: str, period_end: str) -> List[Dict[str, Any]]:
    rows = get_store().records_for_period(period_start, period_end)
    return [
        {
            "employee_name": row.get("employee_name"),
            "employee_id": row.get("employee_id"),
            "identification_id": row.get("identification_id"),
            "phone": row.get("phone"),
            "mobile": row.get("mobile"),
            "email": row.get("email"),
            "amount": row.get("amount"),
            "mpesa_receipt": row.get("mpesa_receipt") or row.get("reference"),
            "reference": row.get("reference"),
            "status": row.get("status"),
            "transaction_date": row.get("transaction_date"),
        }
        for row in rows
    ]


def employee_domain_from_payload(payload: PayRunPayload, rules: Dict[str, Any]) -> List[Any]:
    return payload.employee_domain or list(rules["payrun_creation"].get("employee_domain") or [])


def issue_dicts(issues: List[payroll.Issue]) -> List[Dict[str, Any]]:
    return [asdict(issue) for issue in issues]


def action_dicts(actions: List[payroll.ActionResult]) -> List[Dict[str, Any]]:
    return [asdict(action) for action in actions]


app = FastAPI(
    title="Odoo Payroll Bridge",
    version="1.0.0",
    docs_url=f"{PATH_PREFIX}/docs",
    openapi_url=f"{PATH_PREFIX}/openapi.json",
)
router = APIRouter(prefix=PATH_PREFIX)


@router.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "path_prefix": PATH_PREFIX or "/", "db_path": str(DB_PATH)}


@router.post("/api/advances", dependencies=[Depends(require_token)])
def receive_advances(payload: AdvanceBatchPayload) -> Dict[str, Any]:
    result = get_store().upsert_batch(payload)
    return {
        "status": "ok",
        "period_start": payload.period_start,
        "period_end": payload.period_end,
        **result,
    }


@router.get("/api/advances", dependencies=[Depends(require_token)])
def list_advances(
    period_start: str = Query(...),
    period_end: str = Query(...),
) -> Dict[str, Any]:
    records = get_store().records_for_period(period_start, period_end)
    return {
        "period_start": period_start,
        "period_end": period_end,
        "count": len(records),
        "total_amount": sum(float(record["amount"] or 0) for record in records),
        "records": records,
    }


@router.post("/api/payruns/preview", dependencies=[Depends(require_token)])
def preview_payrun(payload: PayRunPayload) -> Dict[str, Any]:
    rules = load_rules()
    client = make_odoo_client(payload.odoo_credentials)
    employee_domain = employee_domain_from_payload(payload, rules)
    employee_ids = payroll.select_employee_ids(client, rules, employee_domain)
    advance_rows = advance_rows_for_period(payload.date_start, payload.date_end)
    advances, issues = payroll.advance_records_from_rows(advance_rows, rules, start_index=1)

    match_fields = list(rules["payrun_creation"].get("employee_match_fields") or ["name"])
    employees = client.read(rules["models"]["employee"], employee_ids, ["id", *match_fields])
    matched, match_issues = payroll.match_advances_to_employees(advances, employees, match_fields)
    issues.extend(match_issues)

    return {
        "mode": "preview",
        "pay_run_name": payload.pay_run_name,
        "period": {"date_start": payload.date_start, "date_end": payload.date_end},
        "salary_structure": payload.salary_structure,
        "employee_count": len(employee_ids),
        "advance_record_count": len(advances),
        "matched_employee_count": len(matched),
        "advance_total": sum(record.amount for record in advances),
        "matched_advance_total": sum(record.amount for record in matched.values()),
        "issues": issue_dicts(issues),
    }


@router.post("/api/payruns/create", dependencies=[Depends(require_token)])
def create_payrun(payload: PayRunPayload) -> Dict[str, Any]:
    if not payload.confirm_execute:
        raise HTTPException(status_code=400, detail="Set confirm_execute=true to create and process an Odoo pay run.")

    rules = load_rules()
    client = make_odoo_client(payload.odoo_credentials)
    employee_domain = employee_domain_from_payload(payload, rules)
    employee_ids = payroll.select_employee_ids(client, rules, employee_domain)
    advance_rows = advance_rows_for_period(payload.date_start, payload.date_end)
    advances, issues = payroll.advance_records_from_rows(advance_rows, rules, start_index=1)
    actions: List[payroll.ActionResult] = []

    run, create_actions = payroll.create_payrun(
        client,
        rules,
        payload.pay_run_name,
        payload.date_start,
        payload.date_end,
        payload.salary_structure,
    )
    actions.extend(create_actions)
    actions.extend(payroll.create_payslips_for_payrun(client, rules, run, employee_ids, payload.salary_structure))

    failed_setup = [action for action in actions if action.status == "failed"]
    if failed_setup:
        issues.extend(payroll.Issue("ERROR", f"{action.model}:{action.record_id}", action.message) for action in failed_setup)
        return {
            "status": "failed",
            "pay_run": run,
            "actions": action_dicts(actions),
            "issues": issue_dicts(issues),
        }

    run = payroll.resolve_payrun(client, rules["models"]["payrun"], int(run["id"]), None)
    slips = payroll.read_payslips(client, run, rules["models"]["payrun"], rules["models"]["payslip"])
    advance_actions, advance_issues = payroll.apply_salary_advance_records(client, rules, slips, advances, True, issues)
    actions.extend(advance_actions)
    issues = advance_issues

    run = payroll.resolve_payrun(client, rules["models"]["payrun"], int(run["id"]), None)
    slips = payroll.read_payslips(client, run, rules["models"]["payrun"], rules["models"]["payslip"])
    validation_issues, net_by_slip = payroll.validate(client, rules, run, slips)
    issues.extend(validation_issues)

    if not any(issue.severity == "ERROR" for issue in issues):
        actions.extend(payroll.execute_actions(client, rules, run, slips))
        for action in actions:
            if action.status == "failed":
                issues.append(payroll.Issue("ERROR", f"{action.model}:{action.record_id}", action.message))

    status = "ok" if not any(issue.severity == "ERROR" for issue in issues) else "failed"
    return {
        "status": status,
        "pay_run": run,
        "payslip_count": len(slips),
        "net_by_payslip": net_by_slip,
        "actions": action_dicts(actions),
        "issues": issue_dicts(issues),
    }


app.include_router(router)
