import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from '../utils/env';
import { OdooClient } from './odooClient';

dayjs.extend(utc);
dayjs.extend(timezone);

interface OdooModelSummary {
  id: number;
  model: string;
}

interface MailActivityTypeSummary {
  id: number;
  name: string;
}

export interface MailActivitySummary {
  id: number;
  summary?: string | null;
  note?: string | null;
  user_id?: [number, string] | false | null;
  date_deadline?: string | false | null;
  create_date?: string | false | null;
}

export function getActivityTimestamp(date: Date = new Date()): { full: string; short: string } {
  const tz = env.APP_TIMEZONE || 'Africa/Nairobi';
  const d = dayjs(date).tz(tz);
  return {
    full: d.format('YYYY-MM-DD HH:mm:ss [EAT]'),
    short: d.format('D MMM HH:mm'),
  };
}

export function stripSummaryTimestamp(summary: string): string {
  return summary
    .replace(/\[\d{4}-\d{2}-\d{2}[^\]]*\]/gi, '')
    .replace(/\(\d{4}-\d{2}-\d{2}[^)]*\)/gi, '')
    .replace(/[·•-]\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}:\d{2}.*$/gi, '')
    .replace(/[·•-]\s*\d{4}-\d{2}-\d{2}.*$/gi, '')
    .replace(/\(\s*\d{1,2}\s+[A-Za-z]{3}[^)]*\)/gi, '')
    .trim()
    .toLowerCase();
}

function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

function formatDateOnly(value: Date) {
  if (!isValidDate(value)) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function getOdooModelId(client: OdooClient, modelName: string) {
  const models = await client.searchReadRecords<OdooModelSummary>('ir.model', {
    domain: [['model', '=', modelName]],
    fields: ['id', 'model'],
    limit: 1,
  });
  const model = models[0];
  if (!model) {
    throw new Error(`Could not find Odoo model metadata for ${modelName}.`);
  }
  return model.id;
}

export async function getTodoActivityTypeId(client: OdooClient) {
  const todoTypes = await client.searchReadRecords<MailActivityTypeSummary>('mail.activity.type', {
    domain: ['|', ['name', 'ilike', 'To Do'], ['name', 'ilike', 'Todo']],
    fields: ['id', 'name'],
    limit: 1,
    order: 'id asc',
  });

  if (todoTypes[0]) {
    return todoTypes[0].id;
  }

  const fallbackTypes = await client.searchReadRecords<MailActivityTypeSummary>('mail.activity.type', {
    domain: [],
    fields: ['id', 'name'],
    limit: 1,
    order: 'id asc',
  });

  if (!fallbackTypes[0]) {
    throw new Error('Could not find a mail activity type in Odoo.');
  }

  return fallbackTypes[0].id;
}

export async function findOpenActivities(
  client: OdooClient,
  input: {
    modelName: string;
    recordId: number;
    summary?: string;
  },
) {
  const domain: unknown[] = [
    ['res_model', '=', input.modelName],
    ['res_id', '=', input.recordId],
  ];

  const activities = await client.searchReadRecords<MailActivitySummary>('mail.activity', {
    domain,
    fields: ['id', 'summary', 'note', 'user_id', 'date_deadline', 'create_date'],
    limit: 50,
    order: 'id desc',
  });

  if (!input.summary) {
    return activities;
  }

  const cleanInput = stripSummaryTimestamp(input.summary);
  return activities.filter((act) => {
    const rawSummary = String(act.summary || '').trim();
    if (!rawSummary) return false;
    const cleanAct = stripSummaryTimestamp(rawSummary);
    return (
      cleanAct === cleanInput ||
      cleanAct.includes(cleanInput) ||
      cleanInput.includes(cleanAct) ||
      rawSummary.toLowerCase().includes(cleanInput) ||
      cleanInput.includes(rawSummary.toLowerCase())
    );
  });
}

export async function createTodoActivity(
  client: OdooClient,
  input: {
    modelName: string;
    recordId: number;
    userId: number;
    summary: string;
    noteLines: string[];
    deadline?: Date;
  },
) {
  // Prevent duplicate activities: check if an open activity with matching summary already exists on this record
  try {
    const openActivities = await findOpenActivities(client, {
      modelName: input.modelName,
      recordId: input.recordId,
      summary: input.summary,
    });
    if (openActivities.length > 0) {
      return openActivities[0].id;
    }
  } catch (checkErr) {
    // If activity check fails (e.g. permission/network), proceed safely to creation
  }

  const resModelId = await getOdooModelId(client, input.modelName);
  const activityTypeId = await getTodoActivityTypeId(client);
  const { full: timestampFull, short: timestampShort } = getActivityTimestamp();

  // Summary with timestamp: e.g. "Upload Job Summary · 19 Nov 01:05"
  const baseSummary = input.summary.trim();
  const summaryHasTimestamp = /[·•-]\s*\d|\[\d{4}|\(\d{4}|\d{1,2}\s+[A-Za-z]{3}/i.test(baseSummary);
  const finalSummary = summaryHasTimestamp
    ? baseSummary
    : `${baseSummary} · ${timestampShort}`;

  // Note with timestamp
  const noteLinesWithTimestamp = [...input.noteLines];
  const hasTimestampInNote = noteLinesWithTimestamp.some((line) => /timestamp|created\s+at/i.test(line));
  if (!hasTimestampInNote) {
    noteLinesWithTimestamp.push(`Timestamp: ${timestampFull}`);
  }

  const values: Record<string, unknown> = {
    res_model_id: resModelId,
    res_id: input.recordId,
    activity_type_id: activityTypeId,
    user_id: input.userId,
    summary: finalSummary,
    note: `<p>${noteLinesWithTimestamp.map(escapeHtml).join('<br/>')}</p>`,
    date_deadline: formatDateOnly(input.deadline || new Date()),
  };

  return client.createRecord('mail.activity', values);
}

export async function closeActivities(
  client: OdooClient,
  activityIds: number[],
  feedback: string,
) {
  if (activityIds.length === 0) {
    return { closedCount: 0 };
  }

  try {
    await client.callRecordMethod('mail.activity', 'action_feedback', activityIds, { feedback });
  } catch (error) {
    await client.callRecordMethod('mail.activity', 'action_done', activityIds);
  }

  return { closedCount: activityIds.length };
}
