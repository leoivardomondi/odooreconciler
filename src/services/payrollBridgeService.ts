import axios from 'axios';
import { MpesaTransaction } from '../models/types';
import { env } from '../utils/env';

export interface PayrollAdvancePayloadRecord {
  employee_name: string | null;
  phone: string | null;
  amount: number;
  mpesa_receipt: string | null;
  status: string;
  transaction_date: string | null;
  raw: Record<string, unknown>;
}

export interface PayrollAdvanceShareResult {
  received: number;
  inserted: number;
  updated: number;
  period_start: string;
  period_end: string;
}

export interface PayrollPayRunResult {
  status: 'ok' | 'failed' | string;
  pay_run?: {
    id?: number;
    name?: string;
    state?: string;
    [key: string]: unknown;
  };
  payslip_count?: number;
  actions?: Array<Record<string, unknown>>;
  issues?: Array<{
    severity: string;
    subject: string;
    message: string;
  }>;
}

export interface PayrollOdooCredentials {
  baseUrl: string;
  database: string;
  username: string;
  apiKey: string;
}

export interface PayrollBridgeRuntimeConfig {
  url?: string;
  token?: string;
  source?: string;
  salaryStructure?: string;
  payRunNameTemplate?: string;
}

function resolvePayrollBridgeConfig(config?: PayrollBridgeRuntimeConfig) {
  return {
    url: (config?.url || env.PAYROLL_BRIDGE_URL || '').replace(/\/$/, ''),
    token: config?.token || env.PAYROLL_BRIDGE_TOKEN,
    source: config?.source || env.PAYROLL_ADVANCE_SOURCE,
    salaryStructure: config?.salaryStructure || env.PAYROLL_SALARY_STRUCTURE || 'All',
    payRunNameTemplate: config?.payRunNameTemplate || env.PAYROLL_PAY_RUN_NAME_TEMPLATE || '{monthName} {year}',
  };
}

function requireBridgeConfig(config?: PayrollBridgeRuntimeConfig) {
  const resolved = resolvePayrollBridgeConfig(config);

  if (!resolved.url) {
    throw new Error('Payroll bridge URL is not configured.');
  }

  if (!resolved.token) {
    throw new Error('Payroll bridge token is not configured.');
  }

  return resolved;
}

function cleanDate(value: string | null) {
  if (!value) {
    return null;
  }

  const iso = String(value).match(/^(\d{4}-\d{1,2}-\d{1,2})/)?.[1];
  return iso || value;
}

function amountForAdvance(transaction: MpesaTransaction) {
  const withdrawn = Number(transaction.withdrawn || 0);
  const amount = Number(transaction.amount || 0);
  if (withdrawn > 0) {
    return withdrawn;
  }
  return amount > 0 ? amount : 0;
}

export function buildPayrollAdvanceRecords(transactions: MpesaTransaction[]): PayrollAdvancePayloadRecord[] {
  return transactions
    .filter((transaction) => (transaction.userCategory || transaction.transactionType) === 'advance_salary')
    .filter((transaction) => !['ignored', 'new'].includes(transaction.reviewStatus))
    .map((transaction) => ({
      employee_name: transaction.userSupplier || transaction.counterparty,
      phone: transaction.phoneNumber,
      amount: amountForAdvance(transaction),
      mpesa_receipt: transaction.receiptNumber,
      status: 'Completed',
      transaction_date: cleanDate(transaction.transactionDate),
      raw: {
        transactionId: transaction.id,
        batchId: transaction.batchId,
        details: transaction.details,
        counterparty: transaction.counterparty,
        notes: transaction.notes,
      },
    }))
    .filter((record) => record.amount > 0 && Boolean(record.employee_name || record.phone));
}

export async function sharePayrollAdvances(input: {
  periodStart: string;
  periodEnd: string;
  transactions: MpesaTransaction[];
  bridge?: PayrollBridgeRuntimeConfig;
}): Promise<PayrollAdvanceShareResult> {
  const bridge = requireBridgeConfig(input.bridge);
  const records = buildPayrollAdvanceRecords(input.transactions);
  if (!records.length) {
    throw new Error('No reviewed Advance Salary M-Pesa rows were found for this period.');
  }

  const url = `${bridge.url}/api/advances`;
  const response = await axios.post(
    url,
    {
      period_start: input.periodStart,
      period_end: input.periodEnd,
      source: bridge.source,
      records,
    },
    {
      headers: {
        Authorization: `Bearer ${bridge.token}`,
      },
      timeout: 20000,
    },
  );

  return response.data as PayrollAdvanceShareResult;
}

function monthNameForPeriod(periodStart: string) {
  const date = new Date(`${periodStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('en-US', { month: 'short' });
}

function yearForPeriod(periodStart: string) {
  const date = new Date(`${periodStart}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '' : String(date.getFullYear());
}

export function buildPayrollPayRunName(
  periodStart: string,
  periodEnd: string,
  template = env.PAYROLL_PAY_RUN_NAME_TEMPLATE,
) {
  const monthName = monthNameForPeriod(periodStart);
  const year = yearForPeriod(periodStart);
  return (template || '{monthName} {year}')
    .replace(/\{monthName\}/g, monthName)
    .replace(/\{year\}/g, year)
    .replace(/\{periodStart\}/g, periodStart)
    .replace(/\{periodEnd\}/g, periodEnd)
    .trim() || `${monthName} ${year}`.trim();
}

export async function createPayrollPayRun(input: {
  periodStart: string;
  periodEnd: string;
  payRunName?: string;
  odooCredentials?: PayrollOdooCredentials;
  bridge?: PayrollBridgeRuntimeConfig;
}): Promise<PayrollPayRunResult> {
  const bridge = requireBridgeConfig(input.bridge);
  const url = `${bridge.url}/api/payruns/create`;
  const response = await axios.post(
    url,
    {
      pay_run_name:
        input.payRunName ||
        buildPayrollPayRunName(input.periodStart, input.periodEnd, bridge.payRunNameTemplate),
      date_start: input.periodStart,
      date_end: input.periodEnd,
      salary_structure: bridge.salaryStructure,
      confirm_execute: true,
      odoo_credentials: input.odooCredentials
        ? {
            base_url: input.odooCredentials.baseUrl,
            database: input.odooCredentials.database,
            username: input.odooCredentials.username,
            api_key: input.odooCredentials.apiKey,
          }
        : undefined,
    },
    {
      headers: {
        Authorization: `Bearer ${bridge.token}`,
      },
      timeout: 120000,
    },
  );

  return response.data as PayrollPayRunResult;
}

export async function testPayrollBridgeConnection(config?: PayrollBridgeRuntimeConfig) {
  const bridge = requireBridgeConfig(config);
  const response = await axios.get(`${bridge.url}/api/advances`, {
    headers: {
      Authorization: `Bearer ${bridge.token}`,
    },
    params: {
      period_start: '1970-01-01',
      period_end: '1970-01-31',
    },
    timeout: 20000,
  });

  return response.data as { count?: number; total_amount?: number };
}
