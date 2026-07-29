"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOdooModelId = getOdooModelId;
exports.getTodoActivityTypeId = getTodoActivityTypeId;
exports.findOpenActivities = findOpenActivities;
exports.createTodoActivity = createTodoActivity;
exports.closeActivities = closeActivities;
function isValidDate(value) {
    return Number.isFinite(value.getTime());
}
function formatDateOnly(value) {
    if (!isValidDate(value)) {
        return null;
    }
    return value.toISOString().slice(0, 10);
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
async function getOdooModelId(client, modelName) {
    const models = await client.searchReadRecords('ir.model', {
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
async function getTodoActivityTypeId(client) {
    const todoTypes = await client.searchReadRecords('mail.activity.type', {
        domain: ['|', ['name', 'ilike', 'To Do'], ['name', 'ilike', 'Todo']],
        fields: ['id', 'name'],
        limit: 1,
        order: 'id asc',
    });
    if (todoTypes[0]) {
        return todoTypes[0].id;
    }
    const fallbackTypes = await client.searchReadRecords('mail.activity.type', {
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
async function findOpenActivities(client, input) {
    const domain = [
        ['res_model', '=', input.modelName],
        ['res_id', '=', input.recordId],
    ];
    if (input.summary) {
        domain.push(['summary', '=', input.summary]);
    }
    return client.searchReadRecords('mail.activity', {
        domain,
        fields: ['id', 'summary', 'note', 'user_id'],
        limit: 20,
        order: 'id desc',
    });
}
async function createTodoActivity(client, input) {
    const resModelId = await getOdooModelId(client, input.modelName);
    const activityTypeId = await getTodoActivityTypeId(client);
    const values = {
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
async function closeActivities(client, activityIds, feedback) {
    if (activityIds.length === 0) {
        return { closedCount: 0 };
    }
    try {
        await client.callRecordMethod('mail.activity', 'action_feedback', activityIds, { feedback });
    }
    catch (error) {
        await client.callRecordMethod('mail.activity', 'action_done', activityIds);
    }
    return { closedCount: activityIds.length };
}
