import { getSettings } from '../src/models/repositories';
import { OdooClient } from '../src/services/odooClient';
import { retryFailedPoBillPayment } from '../src/services/poBillAutomationService';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../src/utils/helpers';

async function main() {
  console.log('--- Resolving BILL/2026/10/0002 Payment & Overdue Activities ---');

  const settings = await getSettings();
  if (!hasOdooConfiguration(settings)) {
    throw new Error('Odoo is not configured. Please ensure Odoo credentials are setup in settings/env.');
  }

  const client = new OdooClient({
    baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
    database: settings.odoo.database.trim(),
    username: settings.odoo.username.trim(),
    apiKey: settings.odoo.apiKey.trim(),
  });

  const billName = process.env.BILL_NAME || 'BILL/2026/10/0002';
  const poNames = process.env.PO_NAMES
    ? process.env.PO_NAMES.split(',').map((s) => s.trim())
    : ['P01069', 'P01068'];
  const pinNote = (process.env.PIN_NOTE as 'ETR' | 'NO PIN') || 'NO PIN';
  const paymentDate = process.env.PAYMENT_DATE || '2026-10-21';

  console.log(`Target Bill: ${billName}`);
  console.log(`Target POs: ${poNames.join(', ')}`);
  console.log(`PIN Status: ${pinNote}`);
  console.log(`Payment Date: ${paymentDate}`);

  const result = await retryFailedPoBillPayment(client, {
    billName,
    pinNote,
    paymentDate,
    purchaseOrderNames: poNames,
  });

  console.log('\nResult:');
  console.log(`Success: ${result.success}`);
  console.log(`Message: ${result.message}`);
  console.log(`Bill ID: ${result.billId}`);
  console.log(`Bill Name: ${result.billName}`);
  console.log(`Payment State: ${result.paymentState}`);
  console.log(`Activities Closed: ${result.activitiesClosed}`);

  if (result.success) {
    console.log('\n[SUCCESS] Payment registered and overdue activities closed successfully.');
  } else {
    console.error('\n[FAILED] Could not register payment:', result.message);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nFatal Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
