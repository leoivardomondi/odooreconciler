import { getApprovedAuthUserByEmail, getSettings, upsertApprovedAuthUser } from '../models/repositories';
import { AppFeature } from '../models/types';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';

const OPERATOR_DEPARTMENT_NAMES = ['Operations', 'Production', 'Shop Floor', 'Manufacturing', 'Factory'];
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
let syncRunning = false;

export async function syncShopFloorOperatorAccess() {
  if (syncRunning) return { operators: 0, added: 0, updated: 0, skipped: true };
  syncRunning = true;
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const departmentResults = await Promise.all(
      OPERATOR_DEPARTMENT_NAMES.map((name) => client.findDepartmentByName(name)),
    );
    const departments = [...new Map(departmentResults.flat().map((department) => [department.id, department])).values()];
    const employeeResults = await Promise.all(
      departments.map((department) => client.getEmployeesByDepartment(department.id, undefined, true)),
    );
    const employees = [...new Map(employeeResults.flat().map((employee) => [employee.id, employee])).values()]
      .filter((employee) => String(employee.work_email || '').trim());

    let added = 0;
    let updated = 0;
    for (const employee of employees) {
      const email = String(employee.work_email).trim().toLowerCase();
      const existing = await getApprovedAuthUserByEmail(email);
      const apps = [...new Set<AppFeature>([...(existing?.apps || []), 'shop-floor'])];
      if (!existing) added += 1;
      else if (!existing.active || !existing.apps?.includes('shop-floor') || employee.active === false) updated += 1;
      await upsertApprovedAuthUser(
        email,
        existing?.role || 'user',
        apps,
        employee.active !== false,
        null,
      );

    }

    if (added || updated) {
      await logEvent('info', 'Automatically synchronized Odoo operators to Shop Floor access', {
        operators: employees.length,
        added,
        updated,
      });
    }
    return { operators: employees.length, added, updated, skipped: false };
  } finally {
    syncRunning = false;
  }
}

export function startShopFloorOperatorAccessSyncInterval() {
  const run = () => {
    void syncShopFloorOperatorAccess().catch((error) => {
      void logEvent('error', 'Automatic Shop Floor operator access sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  run();
  const timer = setInterval(run, SYNC_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
