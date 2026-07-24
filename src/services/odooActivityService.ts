import { OdooClient } from './odooClient';

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

  if (input.summary) {
    domain.push(['summary', '=', input.summary]);
  }

  return client.searchReadRecords<MailActivitySummary>('mail.activity', {
    domain,
    fields: ['id', 'summary', 'note', 'user_id'],
    limit: 20,
    order: 'id desc',
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
  const resModelId = await getOdooModelId(client, input.modelName);
  const activityTypeId = await getTodoActivityTypeId(client);
  const values: Record<string, unknown> = {
    res_model_id: resModelId,
    res_id: input.recordId,
    activity_type_id: activityTypeId,
    user_id: input.userId,
    summary: input.summary,
    note: `<p>${input.noteLines.map(escapeHtml).join('<br/>')}</p>`,
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
