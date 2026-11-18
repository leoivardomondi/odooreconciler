import { getSettings } from '../src/models/repositories';
import { OdooClient } from '../src/services/odooClient';
import { reconcileLoggedPurchaseOrderReceipts } from '../src/services/boardIntakePoBatchReconciliationService';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(`[Reconcile] Starting Board Intake PO Receipt Reconciliation (dryRun=${dryRun})...`);
  const settings = await getSettings();
  const client = new OdooClient(settings.odoo);

  const report = await reconcileLoggedPurchaseOrderReceipts(client, { dryRun });

  console.log('\n================ RECONCILIATION SUMMARY ================');
  console.log(`Audited POs: ${report.totalAudited}`);
  console.log(`Targets: ${report.targets.length}`);
  console.log(`Validated: ${report.validatedCount}`);
  if (report.errors.length > 0) {
    console.log(`Errors: ${report.errors.length}`);
    for (const err of report.errors) {
      console.error(`  - ${err.poName}: ${err.error}`);
    }
  }

  for (const t of report.targets) {
    console.log(`--------------------------------------------------------`);
    console.log(`PO: ${t.poName} | Picking: ${t.pickingName} (${t.pickingState}) | Action: ${t.action}`);
    for (const l of t.lines) {
      console.log(`  - ${l.productName}: Ordered=${l.orderedQty}, Done=${l.targetDoneQty} [${l.status}]`);
    }
  }
}

main().catch((err) => {
  console.error('[Reconcile] Fatal error:', err);
  process.exit(1);
});
