import { cleanPreexistingMismatchChatter } from '../src/services/boardIntakeSyncService';

async function main() {
  console.log('--- Cleaning Preexisting Board Intake vs PO Mismatch Chatter Messages ---');
  const result = await cleanPreexistingMismatchChatter();
  console.log(`Deleted ${result.deletedCount} mismatch chatter message(s) from Odoo. IDs:`, result.deletedIds);
}

main().catch((err) => {
  console.error('Error running cleanup:', err);
  process.exit(1);
});
