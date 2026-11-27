import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMissingJobSummaryReminder,
  closeOpenJobSummaryReminderActivities,
  postSingleMissingJobSummarySaleOrderNote,
  resetMissingJobSummaryDedupeCaches,
  JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
} from './jobSummaryReminderService';
import {
  auditPurchaseOrderAgainstJobSummary,
  PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY,
} from './poJobSummaryAuditService';
import type { SalesOrderSummary } from '../models/types';

function createStatefulMockOdooClient(options?: {
  linkedPos?: Array<{ id: number; name: string; origin: string; state: string; company_id?: [number, string]; user_id?: [number, string] }>;
  initialActivities?: Array<{ id: number; res_model: string; res_id: number; summary: string; user_id?: [number, string] }>;
  initialMessages?: Array<{ id: number; model: string; res_id: number; body: string }>;
}) {
  let nextActivityId = 1000;
  let nextMessageId = 5000;

  const activities: Array<{ id: number; res_model: string; res_id: number; summary: string; note?: string; user_id?: number }> = [
    ...(options?.initialActivities || []).map((a) => ({
      id: a.id,
      res_model: a.res_model,
      res_id: a.res_id,
      summary: a.summary,
      user_id: Array.isArray(a.user_id) ? a.user_id[0] : undefined,
    })),
  ];
  const messages: Array<{ id: number; model: string; res_id: number; body: string }> = [
    ...(options?.initialMessages || []),
  ];
  const closedActivityIds: number[] = [];

  const linkedPos = options?.linkedPos || [
    { id: 801, name: 'P01453', origin: 'S03950', state: 'purchase', company_id: [1, 'URBAN VIBE'], user_id: [3, 'Buyer'] },
  ];

  const client = {
    getAttachments: async () => [],
    getSaleOrderLines: async () => [
      { id: 1, product_id: [50, 'Edge Banding Service Gloss White'], name: 'Edge Banding Service', price_total: 2500, price_subtotal: 2500, display_type: false },
    ],
    readRecords: async (model: string, ids: number[]) => {
      if (model === 'purchase.order') {
        return linkedPos.filter((p) => ids.includes(p.id));
      }
      return [];
    },
    searchReadRecords: async (model: string, opts: { domain?: unknown[] } = {}) => {
      const domain = opts.domain || [];
      if (model === 'ir.model') {
        return [{ id: 99, model: 'sale.order' }];
      }
      if (model === 'mail.activity.type') {
        return [{ id: 4, name: 'To Do' }];
      }
      if (model === 'res.users') {
        return [{ id: 2, name: 'Charles Onyango', login: 'charles', partner_id: [20, 'Charles Onyango'] }];
      }
      if (model === 'sale.order') {
        return [{ id: 4100, name: 'S03950', user_id: [13, 'Candy Venesa'], partner_id: [70, 'Client'] }];
      }
      if (model === 'purchase.order') {
        return linkedPos;
      }
      if (model === 'mail.activity') {
        const resModelCond = domain.find((c): c is [string, string, unknown] => Array.isArray(c) && c[0] === 'res_model');
        const resIdCond = domain.find((c): c is [string, string, unknown] => Array.isArray(c) && c[0] === 'res_id');
        return activities.filter((act) => {
          if (resModelCond && act.res_model !== resModelCond[2]) return false;
          if (resIdCond) {
            if (resIdCond[1] === '=' && act.res_id !== resIdCond[2]) return false;
            if (resIdCond[1] === 'in' && (!Array.isArray(resIdCond[2]) || !resIdCond[2].includes(act.res_id))) return false;
          }
          return true;
        });
      }
      if (model === 'mail.message') {
        const modelCond = domain.find((c): c is [string, string, unknown] => Array.isArray(c) && c[0] === 'model');
        const resIdCond = domain.find((c): c is [string, string, unknown] => Array.isArray(c) && c[0] === 'res_id');
        const bodyTerms = domain
          .filter((c): c is [string, string, unknown] => Array.isArray(c) && c[0] === 'body')
          .map((c) => String(c[2] || '').toLowerCase());
        return messages.filter((msg) => {
          if (modelCond && msg.model !== modelCond[2]) return false;
          if (resIdCond && msg.res_id !== resIdCond[2]) return false;
          if (bodyTerms.length > 0) {
            const lower = msg.body.toLowerCase();
            return bodyTerms.some((term) => lower.includes(term));
          }
          return true;
        });
      }
      return [];
    },
    createRecord: async (model: string, values: Record<string, unknown>) => {
      if (model === 'mail.activity') {
        const id = ++nextActivityId;
        activities.push({
          id,
          res_model: values.res_model_id ? (Number(values.res_id) === 801 ? 'purchase.order' : 'sale.order') : 'sale.order',
          res_id: Number(values.res_id),
          summary: String(values.summary || ''),
          note: String(values.note || ''),
          user_id: Number(values.user_id || 0),
        });
        return id;
      }
      return 1;
    },
    postModelChatterMessage: async (model: string, recordId: number, message: string) => {
      const id = ++nextMessageId;
      messages.push({ id, model, res_id: recordId, body: message });
      return id;
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'mail.activity' && (method === 'action_feedback' || method === 'action_done')) {
        closedActivityIds.push(...ids);
        for (const id of ids) {
          const idx = activities.findIndex((a) => a.id === id);
          if (idx >= 0) activities.splice(idx, 1);
        }
      }
      return true;
    },
    // Allow auditLinked / resolveCombinedJobSummary fallback path to find no PDFs
    request: async () => [],
  };

  return { client: client as any, activities, messages, closedActivityIds };
}

const SAMPLE_SO: SalesOrderSummary = {
  id: 4100,
  name: 'S03950',
  state: 'sale',
  user_id: [13, 'Candy Venesa'],
  create_uid: [13, 'Candy Venesa'],
};

test('Missing Job Summary Reminder & Note Unification', async (t) => {
  await t.test('1. Repeated or concurrent Sales Background Scheduler calls create strictly 1 activity and 1 note', async () => {
    resetMissingJobSummaryDedupeCaches();
    const { client, activities, messages } = createStatefulMockOdooClient();

    const [r1, r2] = await Promise.all([
      ensureMissingJobSummaryReminder(client, SAMPLE_SO, 'job summary', []),
      ensureMissingJobSummaryReminder(client, SAMPLE_SO, 'job summary', []),
    ]);
    const r3 = await ensureMissingJobSummaryReminder(client, SAMPLE_SO, 'job summary', []);

    assert.equal(r1.status, 'created');
    assert.equal(r2.status, 'already_exists');
    assert.equal(r3.status, 'already_exists');
    assert.equal(activities.length, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].model, 'sale.order');
    assert.match(messages[0].body, /Job Summary Required/i);
  });

  await t.test('2. PO audit creates 1 activity & only the top Job Summary Required note; Sales Scheduler does not duplicate either', async () => {
    resetMissingJobSummaryDedupeCaches();
    const { client, activities, messages } = createStatefulMockOdooClient({
      linkedPos: [
        { id: 801, name: 'P01453', origin: 'S03950', state: 'purchase', company_id: [1, 'URBAN VIBE'], user_id: [3, 'Buyer'] },
      ],
    });

    const poRes = await auditPurchaseOrderAgainstJobSummary(client, 801, {
      sheetMaterials: [],
      items: [],
    } as any);
    assert.equal(poRes.actionTaken, 'no_job_summary_found');
    assert.equal(activities.length, 1);
    assert.equal(activities[0].res_id, 801);
    assert.ok(activities[0].summary.includes(PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY));

    // Only ONE chatter note posted — on sale.order with the "Job Summary Required for PO P01453" format (never Job Summary Missing Alert)
    assert.equal(messages.length, 1);
    assert.equal(messages[0].model, 'sale.order');
    assert.equal(messages[0].res_id, 4100);
    assert.match(messages[0].body, /Job Summary Required for PO P01453/);
    assert.ok(!messages.some((m) => m.body.includes('Job Summary Missing Alert')));

    // Now simulate Sales Background Scheduler running for S03950 (even after clearing memory caches)
    resetMissingJobSummaryDedupeCaches();
    const schedRes = await ensureMissingJobSummaryReminder(client, SAMPLE_SO, 'job summary', []);
    assert.equal(schedRes.status, 'already_exists');
    assert.equal(schedRes.sourceModel, 'purchase.order');
    assert.equal(activities.length, 1);
    assert.equal(messages.length, 1);
  });

  await t.test('3. Reverse order: Sales Scheduler runs first, then PO audit runs — still 1 activity and 1 note total', async () => {
    resetMissingJobSummaryDedupeCaches();
    const { client, activities, messages } = createStatefulMockOdooClient();

    const schedRes = await ensureMissingJobSummaryReminder(client, SAMPLE_SO, 'job summary', []);
    assert.equal(schedRes.status, 'created');
    assert.equal(activities.length, 1);
    assert.equal(messages.length, 1);

    // Simulate PO Audit running on a separate worker / later run (clear RAM cache)
    resetMissingJobSummaryDedupeCaches();
    const poRes = await auditPurchaseOrderAgainstJobSummary(client, 801, {
      sheetMaterials: [],
      items: [],
    } as any);
    assert.equal(poRes.actionTaken, 'no_job_summary_found');
    assert.equal(activities.length, 1);
    assert.equal(messages.length, 1);
  });

  await t.test('4. Multiple confirmed POs on same SO produce only 1 activity and 1 SO note total', async () => {
    resetMissingJobSummaryDedupeCaches();
    const { client, activities, messages } = createStatefulMockOdooClient({
      linkedPos: [
        { id: 801, name: 'P01453', origin: 'S03950', state: 'purchase', company_id: [1, 'URBAN VIBE'], user_id: [3, 'Buyer'] },
        { id: 802, name: 'P01454', origin: 'S03950', state: 'purchase', company_id: [1, 'URBAN VIBE'], user_id: [3, 'Buyer'] },
      ],
    });

    await Promise.all([
      auditPurchaseOrderAgainstJobSummary(client, 801, { sheetMaterials: [], items: [] } as any),
      auditPurchaseOrderAgainstJobSummary(client, 802, { sheetMaterials: [], items: [] } as any),
    ]);

    assert.equal(activities.length, 1);
    assert.equal(messages.length, 1);
  });

  await t.test('5. Legacy mirrored Job Summary Missing Alert on SO chatter prevents duplicate note', async () => {
    resetMissingJobSummaryDedupeCaches();
    const { client, messages } = createStatefulMockOdooClient({
      initialMessages: [
        { id: 4999, model: 'sale.order', res_id: 4100, body: '<p>⚠️ Job Summary Missing Alert (@Charles)</p>' },
      ],
    });

    const noteRes = await postSingleMissingJobSummarySaleOrderNote(client, {
      saleOrderId: 4100,
      poName: 'P01453',
    });
    assert.equal(noteRes.posted, false);
    assert.equal(noteRes.reason, 'already_exists');
    assert.equal(messages.length, 1);
  });

  await t.test('6. Uploading Job Summary closes open missing-JS activities on both SO and linked POs', async () => {
    resetMissingJobSummaryDedupeCaches();
    const { client, activities, closedActivityIds } = createStatefulMockOdooClient({
      initialActivities: [
        { id: 701, res_model: 'sale.order', res_id: 4100, summary: `${JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY} · 23 Nov 21:00` },
        { id: 702, res_model: 'purchase.order', res_id: 801, summary: `${PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY} · 23 Nov 20:57` },
      ],
    });

    const closeRes = await closeOpenJobSummaryReminderActivities(client, 4100, 'Job Summary PDF detected', 'S03950');
    assert.equal(closeRes.closedCount, 2);
    assert.deepEqual(closedActivityIds.sort(), [701, 702]);
    assert.equal(activities.length, 0);
  });
});
