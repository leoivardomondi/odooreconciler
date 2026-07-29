"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMoOvertimeSuggestion = sendMoOvertimeSuggestion;
exports.startMoOvertimeSuggestionInterval = startMoOvertimeSuggestionInterval;
const repositories_1 = require("../models/repositories");
const logService_1 = require("./logService");
const mailTransport_1 = require("./mailTransport");
const odooClient_1 = require("./odooClient");
const OVERTIME_BOARD_THRESHOLD = 50;
let interval = null;
let lastSentKey = '';
function nairobiParts() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return { key: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
async function sendMoOvertimeSuggestion(recipientOverride = '') {
    const [settings, users] = await Promise.all([(0, repositories_1.getSettings)(), (0, repositories_1.getApprovedAuthUsers)()]);
    const warehouseId = Number(settings.stock.warehouseId || 0);
    if (!warehouseId)
        return false;
    const recipient = recipientOverride
        ? { email: recipientOverride.trim() }
        : users.find((user) => user.active && /leo(?:i)?vard/i.test(user.email));
    if (!recipient)
        throw new Error('No active Leovard user was found for the overtime suggestion email.');
    const client = new odooClient_1.OdooClient(settings.odoo);
    const orders = await client.getWarehouseScopedActiveWorkOrders(warehouseId, 500);
    const largeCuttingOrders = orders.filter((order) => {
        const product = Array.isArray(order.product_id) ? String(order.product_id[1] || '') : String(order.product_id || '');
        return !/edge\s*band|edging/i.test(product) && Number(order.product_qty || 0) >= OVERTIME_BOARD_THRESHOLD && !['done', 'cancel'].includes(order.state);
    });
    if (!largeCuttingOrders.length)
        return false;
    const rows = largeCuttingOrders.map((order) => `<tr><td>${order.name}</td><td>${Array.isArray(order.product_id) ? order.product_id[1] : order.product_id}</td><td>${order.product_qty}</td><td>${order.origin || '-'}</td></tr>`).join('');
    await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to: recipient.email,
        subject: `Overtime suggestion: ${largeCuttingOrders.length} large cutting MO${largeCuttingOrders.length === 1 ? '' : 's'}`,
        html: `<p>The confirmed cutting queue contains work of 50 boards or more. Consider overtime to protect the estimated completion times.</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>MO</th><th>Job</th><th>Boards</th><th>Client reference</th></tr></thead><tbody>${rows}</tbody></table><p>Capacity is based on 8:00 AM–5:00 PM Monday–Friday and 8:00 AM–2:00 PM Saturday, less the scheduled breakfast and lunch breaks.</p>`,
    });
    await (0, logService_1.logEvent)('info', 'Large MO overtime suggestion sent', { recipient: recipient.email, moIds: largeCuttingOrders.map((order) => order.id) });
    return true;
}
function startMoOvertimeSuggestionInterval() {
    if (interval)
        return;
    const check = async () => {
        const { key, hour } = nairobiParts();
        if (hour < 8 || lastSentKey === key)
            return;
        try {
            await sendMoOvertimeSuggestion();
            lastSentKey = key;
        }
        catch (error) {
            console.error('[mo-overtime-suggestion]', error);
        }
    };
    void check();
    interval = setInterval(() => void check(), 60 * 60 * 1000);
}
