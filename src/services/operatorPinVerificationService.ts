import {
  getShopFloorOperatorByPin,
  upsertShopFloorOperators,
  getSettings,
  ShopFloorOperatorEntry,
} from '../models/repositories';
import { OdooClient } from './odooClient';

/**
 * Verify an operator or employee attendance PIN against MySQL shop_floor_operators,
 * with a fallback check to live Odoo hr.employee kiosk attendance PIN.
 */
export async function verifyEmployeeAttendancePin(pin: string): Promise<ShopFloorOperatorEntry | null> {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return null;

  // 1. Check local MySQL / SQLite database (<2ms)
  const localOp = await getShopFloorOperatorByPin(cleanPin);
  if (localOp) return localOp;

  // 2. Fallback check live Odoo hr.employee
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const targetCompanyId = await client.getTargetCompanyIdValue();
    const employees = await client.searchReadRecords<{
      id: number;
      name: string;
      work_email: string | false;
      mobile_phone: string | false;
      job_title: string | false;
      user_id: [number, string] | false;
      pin: string | false;
    }>('hr.employee', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['active', '=', true],
        ['pin', '=', cleanPin],
      ],
      fields: ['id', 'name', 'work_email', 'mobile_phone', 'job_title', 'user_id', 'pin'],
      limit: 1,
    });

    if (employees.length && String(employees[0].pin || '').trim() === cleanPin) {
      const emp = employees[0];
      const opEntry: ShopFloorOperatorEntry = {
        id: emp.id,
        name: String(emp.name || '').trim(),
        jobTitle: emp.job_title ? String(emp.job_title).trim() : null,
        department: null,
        workEmail: emp.work_email ? String(emp.work_email).trim().toLowerCase() : null,
        mobilePhone: emp.mobile_phone ? String(emp.mobile_phone).trim() : null,
        userId: Array.isArray(emp.user_id) ? emp.user_id[0] : null,
        userName: Array.isArray(emp.user_id) ? emp.user_id[1] : emp.name,
        photoUrl: null,
        checkedIn: false,
        checkedOut: false,
        checkInTime: null,
        assignedItems: [],
        priority: 2,
        active: true,
        pin: cleanPin,
      };
      // Cache operator into MySQL / SQLite
      await upsertShopFloorOperators([opEntry]).catch(() => {});
      return opEntry;
    }
  } catch (err) {
    console.warn('[verifyEmployeeAttendancePin] Odoo PIN verification fallback error:', err);
  }

  return null;
}
