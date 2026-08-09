import { getSettings } from './src/models/repositories.js';
import { OdooClient } from './src/services/odooClient.js';
import { runPoBillAutomation } from './src/services/poBillAutomationService.js';
import { sanitizeBaseUrl } from './src/utils/helpers.js';

async function main() {
  console.log('Loading settings...');
  const settings = await getSettings();
  const client = new OdooClient({
    baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
    database: settings.odoo.database,
    username: settings.odoo.username,
    apiKey: settings.odoo.apiKey,
  });

  console.log('Running PO Bill Automation for attachment 11708...');
  const result = await runPoBillAutomation(client, {
    attachmentId: 11708,
    purchaseOrderSearch: '',
    mode: 'review',
    aiConfig: settings.ai,
  });

  const inv = result.parsedInvoice;
  console.log('\n=== PARSED INVOICE ===');
  console.log('Vendor:', (inv as any)?.vendorName);
  console.log('Date:', (inv as any)?.invoiceDate);
  console.log('Invoice #:', (inv as any)?.invoiceNumber);
  console.log('Grand total:', (inv as any)?.grandTotal);
  console.log('Items:', (inv as any)?.itemCount);

  console.log('\n=== LOGS ===');
  ((inv as any)?.logs || []).forEach((log: string) => console.log(' -', log));

  console.log('\n=== TOP CANDIDATE ===');
  const top = ((result as any).candidates || [])[0];
  if (top) {
    console.log('PO:', top.purchaseOrder?.name, '| Score:', top.score);
    console.log('Reasons:');
    top.reasons?.forEach((r: string) => console.log(' >', r));
  } else {
    console.log('No candidates found.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
