import { Request, Response, Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { beginStaffOnboardingApproval, createStaffOnboardingApplication, finishStaffOnboardingApproval, getSettings, getStaffOnboardingApplication, getStaffOnboardingApplications, importStaffOnboardingApplication, updateStaffOnboardingSync } from '../models/repositories';
import { OdooClient } from '../services/odooClient';
import { logEvent } from '../services/logService';

const router = Router();
const PREFIX = '[STAFF ONBOARDING]';
const MARKER = 'STAFF_ONBOARDING_JSON:';
const recentSubmissions = new Map<string, number>();

type Payload = Record<string, string>;
const text = (value: unknown, max = 250) => String(value || '').trim().slice(0, max);
function encode(payload: Payload) { return `${MARKER}${Buffer.from(JSON.stringify(payload)).toString('base64')}`; }
function decode(value: unknown): Payload | null {
  const source = String(value || ''); const index = source.indexOf(MARKER); if (index < 0) return null;
  try { return JSON.parse(Buffer.from(source.slice(index + MARKER.length).split(/\s|</)[0], 'base64').toString('utf8')); } catch { return null; }
}
async function client() { const settings = await getSettings(); return new OdooClient(settings.odoo); }
async function supportedValues(odoo: OdooClient, model: string, values: Record<string, unknown>) {
  const fields = await odoo.getModelFields(model, Object.keys(values)); const allowed = new Set(fields.map((field) => field.name));
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => allowed.has(key) && value !== '' && value !== null && value !== undefined));
}
async function relationId(odoo: OdooClient, model: string, name: string) {
  if (!name) return null;
  const rows = await odoo.searchReadRecords<{ id: number }>(model, { domain: [['name', 'ilike', name]], fields: ['id'], limit: 1 });
  return rows[0]?.id || null;
}
async function syncApplicantToOdoo(odoo: OdooClient, payload: Payload) {
  const partnerName = `${PREFIX} ${payload.fullName}`;
  const existing = await odoo.searchReadRecords<{ id: number }>('hr.applicant', {
    domain: [['partner_name', '=', partnerName], ['email_from', '=', payload.personalEmail]],
    fields: ['id'], limit: 1, order: 'id desc',
  });
  if (existing[0]?.id) return Number(existing[0].id);
  const values = await supportedValues(odoo, 'hr.applicant', {
    partner_name: partnerName, email_from: payload.personalEmail,
    partner_phone: payload.mobilePhone, applicant_notes: encode(payload),
  });
  return odoo.createRecord('hr.applicant', values);
}

router.get('/staff-onboarding', (_req, res) => res.render('staff-onboarding', { pageTitle: 'Staff Onboarding', submitted: _req.query.submitted === '1', error: _req.query.error || null }));

router.post('/staff-onboarding', async (req: Request, res: Response) => {
  let localId = '';
  try {
    if (text(req.body.website)) { res.redirect('/staff-onboarding?submitted=1'); return; }
    const ip = req.ip || 'unknown'; const previous = recentSubmissions.get(ip) || 0;
    if (Date.now() - previous < 60_000) { res.redirect('/staff-onboarding?error=' + encodeURIComponent('Please wait one minute before submitting again.')); return; }
    const payload: Payload = {};
    ['fullName','personalEmail','mobilePhone','birthday','gender','marital','identificationId','passportId','street','city','county','emergencyContact','emergencyPhone','kraPin','nssfNumber','shaNumber','bankName','bankAccount','bankBranch','education','school','notes'].forEach((key) => { payload[key] = text(req.body[key], key === 'notes' ? 1500 : 250); });
    if (!payload.fullName || !payload.personalEmail || !payload.mobilePhone || !payload.identificationId) throw new Error('Full name, personal email, mobile phone and national ID are required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.personalEmail)) throw new Error('Enter a valid personal email address.');
    localId = uuidv4();
    await createStaffOnboardingApplication({ id: localId, payload });
    recentSubmissions.set(ip, Date.now());
    const odoo = await client();
    const applicantId = await syncApplicantToOdoo(odoo, payload);
    await updateStaffOnboardingSync(localId, applicantId);
    await logEvent('info', 'Public staff onboarding submitted', { applicantId, name: payload.fullName });
    res.redirect('/staff-onboarding?submitted=1');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not submit onboarding form.';
    if (localId) {
      await updateStaffOnboardingSync(localId, null, message).catch(() => undefined);
      res.redirect('/staff-onboarding?submitted=1');
      return;
    }
    res.redirect('/staff-onboarding?error=' + encodeURIComponent(message));
  }
});

router.get('/settings/staff-onboarding', async (req: Request, res: Response) => {
  if (req.authUser?.role !== 'admin') { res.status(403).send('Administrator access required.'); return; }
  const applications = await getStaffOnboardingApplications();
  res.render('staff-onboarding-review', {
    pageTitle: 'Staff Onboarding Approvals', applications,
    message: typeof req.query.message === 'string' ? req.query.message : null,
    error: typeof req.query.error === 'string' ? req.query.error : null,
    csrfToken: req.csrfToken || null,
  });
});

router.post('/settings/staff-onboarding/import', async (req: Request, res: Response) => {
  if (req.authUser?.role !== 'admin') { res.status(403).send('Administrator access required.'); return; }
  try {
    const odoo = await client();
    const rows = await odoo.searchReadRecords<{ id: number; applicant_notes?: string }>('hr.applicant', {
      domain: [['partner_name', 'ilike', PREFIX]], fields: ['id', 'applicant_notes'], limit: 200, order: 'create_date desc',
    });
    let imported = 0;
    for (const row of rows) {
      const payload = decode(row.applicant_notes);
      if (!payload?.fullName || !payload.personalEmail) continue;
      await importStaffOnboardingApplication({ id: uuidv4(), payload, odooApplicantId: row.id });
      imported += 1;
    }
    res.redirect('/settings/staff-onboarding?message=' + encodeURIComponent(`${imported} existing application(s) synchronized from Odoo.`));
  } catch (error) {
    res.redirect('/settings/staff-onboarding?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Could not import Odoo applications.'));
  }
});

router.post('/settings/staff-onboarding/:id/sync', async (req: Request, res: Response) => {
  if (req.authUser?.role !== 'admin') { res.status(403).send('Administrator access required.'); return; }
  const application = await getStaffOnboardingApplication(req.params.id);
  if (!application || application.odooApplicantId) { res.redirect('/settings/staff-onboarding'); return; }
  try {
    const odoo = await client(); const payload = application.payload;
    const applicantId = await syncApplicantToOdoo(odoo, payload);
    await updateStaffOnboardingSync(application.id, applicantId);
    res.redirect('/settings/staff-onboarding?message=' + encodeURIComponent('Application synchronized with Odoo.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Odoo synchronization failed.';
    await updateStaffOnboardingSync(application.id, null, message);
    res.redirect('/settings/staff-onboarding?error=' + encodeURIComponent(message));
  }
});

router.post('/settings/staff-onboarding/:id/approve', async (req: Request, res: Response) => {
  if (req.authUser?.role !== 'admin' || !req.authUser) { res.status(403).send('Administrator access required.'); return; }
  const application = await getStaffOnboardingApplication(req.params.id);
  if (!application) { res.redirect('/settings/staff-onboarding?error=' + encodeURIComponent('Application not found.')); return; }
  if (!application.odooApplicantId) { res.redirect('/settings/staff-onboarding?error=' + encodeURIComponent('Synchronize this application with Odoo before approval.')); return; }
  if (!(await beginStaffOnboardingApproval(application.id))) { res.redirect('/settings/staff-onboarding?error=' + encodeURIComponent('This application is already approved or being processed.')); return; }
  const reviewer = req.authUser.displayName || req.authUser.email;
  try {
    const odoo = await client(); const payload = application.payload;
    const companyId = await odoo.getTargetCompanyIdValue();
    const employeeId = await odoo.createRecord('hr.employee', await supportedValues(odoo, 'hr.employee', {
      name: payload.fullName, company_id: companyId, private_email: payload.personalEmail, private_phone: payload.mobilePhone,
      birthday: payload.birthday, sex: payload.gender, marital: payload.marital, identification_id: payload.identificationId,
      passport_id: payload.passportId, private_street: payload.street, private_city: payload.city, emergency_contact: payload.emergencyContact,
      emergency_phone: payload.emergencyPhone,
      l10n_ke_kra_pin: payload.kraPin, l10n_ke_nssf_number: payload.nssfNumber,
      l10n_ke_sha_number: payload.shaNumber || payload.shifNumber,
      l10n_ke_shif_number: payload.shaNumber || payload.shifNumber,
      study_field: payload.education, study_school: payload.school, additional_note: payload.notes,
    }));
    await finishStaffOnboardingApproval(application.id, { employeeId, reviewedBy: reviewer });
    if (payload.bankAccount) {
      try {
        const employee = await odoo.searchReadRecords<{ work_contact_id?: [number,string]; private_address_id?: [number,string] }>('hr.employee', { domain: [['id','=',employeeId]], fields: ['work_contact_id','private_address_id'], limit: 1 });
        const partner = employee[0]?.private_address_id?.[0] || employee[0]?.work_contact_id?.[0];
        const bankId = await relationId(odoo, 'res.bank', payload.bankName);
        if (partner) await odoo.createRecord('res.partner.bank', await supportedValues(odoo, 'res.partner.bank', { partner_id: partner, bank_id: bankId, acc_number: payload.bankAccount, acc_holder_name: payload.fullName }));
      } catch (bankError) {
        await logEvent('error', 'Approved employee bank record follow-up failed', { applicationId: application.id, employeeId, error: bankError instanceof Error ? bankError.message : String(bankError) }).catch(() => undefined);
      }
    }
    await odoo.writeRecord('hr.applicant', [application.odooApplicantId], { partner_name: `[APPROVED ${employeeId}] ${payload.fullName}` }).catch((applicantError) =>
      logEvent('error', 'Approved applicant label follow-up failed', { applicationId: application.id, employeeId, error: applicantError instanceof Error ? applicantError.message : String(applicantError) }).catch(() => undefined));
    await logEvent('info', 'Staff onboarding approved and Odoo employee created', { applicationId: application.id, employeeId, approvedBy: reviewer, approvedByEmail: req.authUser.email });
    res.redirect('/settings/staff-onboarding?message=' + encodeURIComponent(`${payload.fullName} was created as employee ${employeeId}.`));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not approve onboarding.';
    const latest = await getStaffOnboardingApplication(application.id);
    if (latest?.status !== 'approved') await finishStaffOnboardingApproval(application.id, { reviewedBy: reviewer, errorMessage: message });
    res.redirect('/settings/staff-onboarding?error=' + encodeURIComponent(message));
  }
});

export default router;
