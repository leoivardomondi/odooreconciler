"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActivityTimestamp = getActivityTimestamp;
exports.stripSummaryTimestamp = stripSummaryTimestamp;
exports.getOdooModelId = getOdooModelId;
exports.getTodoActivityTypeId = getTodoActivityTypeId;
exports.findOpenActivities = findOpenActivities;
exports.createTodoActivity = createTodoActivity;
exports.closeActivities = closeActivities;
const dayjs_1 = __importDefault(require("dayjs"));
const utc_1 = __importDefault(require("dayjs/plugin/utc"));
const timezone_1 = __importDefault(require("dayjs/plugin/timezone"));
const env_1 = require("../utils/env");
dayjs_1.default.extend(utc_1.default);
dayjs_1.default.extend(timezone_1.default);
function getActivityTimestamp(date = new Date()) {
    const tz = env_1.env.APP_TIMEZONE || 'Africa/Nairobi';
    const d = (0, dayjs_1.default)(date).tz(tz);
    return {
        full: d.format('YYYY-MM-DD HH:mm:ss [EAT]'),
        short: d.format('D MMM HH:mm'),
    };
}
function stripSummaryTimestamp(summary) {
    return summary
        .replace(/\[\d{4}-\d{2}-\d{2}[^\]]*\]/gi, '')
        .replace(/\(\d{4}-\d{2}-\d{2}[^)]*\)/gi, '')
        .replace(/[·•-]\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}:\d{2}.*$/gi, '')
        .replace(/[·•-]\s*\d{4}-\d{2}-\d{2}.*$/gi, '')
        .replace(/\(\s*\d{1,2}\s+[A-Za-z]{3}[^)]*\)/gi, '')
        .trim()
        .toLowerCase();
}
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
    const activities = await client.searchReadRecords('mail.activity', {
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
        if (!rawSummary)
            return false;
        const cleanAct = stripSummaryTimestamp(rawSummary);
        return (cleanAct === cleanInput ||
            cleanAct.includes(cleanInput) ||
            cleanInput.includes(cleanAct) ||
            rawSummary.toLowerCase().includes(cleanInput) ||
            cleanInput.includes(rawSummary.toLowerCase()));
    });
}
async function createTodoActivity(client, input) {
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
    }
    catch (checkErr) {
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
    const values = {
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
