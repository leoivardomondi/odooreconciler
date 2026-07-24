"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
exports.getCachedModelFields = getCachedModelFields;
exports.saveCachedModelFields = saveCachedModelFields;
exports.insertSchedulerRun = insertSchedulerRun;
exports.updateSchedulerRun = updateSchedulerRun;
exports.getSchedulerRunById = getSchedulerRunById;
exports.getRecentSchedulerRuns = getRecentSchedulerRuns;
exports.updateConnectionStatus = updateConnectionStatus;
exports.insertLog = insertLog;
exports.getRecentLogs = getRecentLogs;
exports.insertHistory = insertHistory;
exports.updateHistory = updateHistory;
exports.getHistoryById = getHistoryById;
exports.getRecentHistory = getRecentHistory;
exports.insertExtractedResult = insertExtractedResult;
exports.getExtractedResultByHistoryId = getExtractedResultByHistoryId;
exports.getLatestExtractedResultByOrderId = getLatestExtractedResultByOrderId;
exports.getProcessedStockVariantIds = getProcessedStockVariantIds;
exports.getUnreversedProcessedStockItemsForOrder = getUnreversedProcessedStockItemsForOrder;
exports.insertProcessedStockItem = insertProcessedStockItem;
exports.markProcessedStockItemReversed = markProcessedStockItemReversed;
exports.acquireStockProcessingLock = acquireStockProcessingLock;
exports.releaseStockProcessingLock = releaseStockProcessingLock;
exports.isStockProcessingLocked = isStockProcessingLocked;
exports.insertAuthLoginChallenge = insertAuthLoginChallenge;
exports.getLatestActiveAuthLoginChallenge = getLatestActiveAuthLoginChallenge;
exports.updateAuthLoginChallenge = updateAuthLoginChallenge;
exports.consumeAllAuthChallengesForEmail = consumeAllAuthChallengesForEmail;
exports.insertAuthSession = insertAuthSession;
exports.getAuthSession = getAuthSession;
exports.touchAuthSession = touchAuthSession;
exports.revokeAuthSession = revokeAuthSession;
exports.revokeExpiredAuthSessions = revokeExpiredAuthSessions;
exports.insertAuthAttempt = insertAuthAttempt;
exports.countRecentAuthAttempts = countRecentAuthAttempts;
const uuid_1 = require("uuid");
const db_1 = require("./db");
const crypto_1 = require("../utils/crypto");
const helpers_1 = require("../utils/helpers");
function getSettingsRow() {
    const row = db_1.db
        .prepare(`
      SELECT
        odoo_base_url,
        odoo_database,
        odoo_username,
        odoo_api_key_encrypted,
        field_mapping_json,
        parser_config_json,
        scheduler_config_json,
        stock_config_json,
        connection_status,
        connection_checked_at,
        connection_message,
        connection_version,
        updated_at
      FROM settings
      WHERE id = 1
      `)
        .get();
    if (!row) {
        throw new Error('Application settings row is missing.');
    }
    return row;
}
function getSettings() {
    const row = getSettingsRow();
    const rawFieldMappings = (0, helpers_1.safeJsonParse)(row.field_mapping_json, {});
    const fieldMappings = {
        ...(0, helpers_1.createEmptyFieldMappings)(),
        ...rawFieldMappings,
        logField: rawFieldMappings.logField ?? rawFieldMappings.processingLogField ?? '',
        processedAtField: rawFieldMappings.processedAtField ?? rawFieldMappings.lastProcessedAtField ?? '',
        attachmentNameField: rawFieldMappings.attachmentNameField ??
            rawFieldMappings.lastAttachmentNameField ??
            '',
        signatureField: rawFieldMappings.signatureField ?? '',
    };
    const parser = {
        ...helpers_1.DEFAULT_PARSER_CONFIG,
        ...(0, helpers_1.safeJsonParse)(row.parser_config_json, {}),
    };
    const scheduler = {
        ...helpers_1.DEFAULT_SCHEDULER_CONFIG,
        ...(0, helpers_1.safeJsonParse)(row.scheduler_config_json, {}),
    };
    const stock = {
        ...helpers_1.DEFAULT_STOCK_CONFIG,
        ...(0, helpers_1.safeJsonParse)(row.stock_config_json, {}),
    };
    return {
        odoo: {
            baseUrl: row.odoo_base_url || '',
            database: row.odoo_database || '',
            username: row.odoo_username || '',
            apiKey: row.odoo_api_key_encrypted ? (0, crypto_1.decryptSecret)(row.odoo_api_key_encrypted) : '',
        },
        fieldMappings,
        parser: {
            ...parser,
            postChatterOnSuccess: Boolean(parser.postChatterOnSuccess),
        },
        scheduler: {
            ...scheduler,
            enabled: Boolean(scheduler.enabled),
            useInProcessInterval: Boolean(scheduler.useInProcessInterval),
            intervalMinutes: Number(scheduler.intervalMinutes || helpers_1.DEFAULT_SCHEDULER_CONFIG.intervalMinutes),
            batchSize: Number(scheduler.batchSize || helpers_1.DEFAULT_SCHEDULER_CONFIG.batchSize),
        },
        stock: {
            locationId: String(stock.locationId || ''),
            locationName: String(stock.locationName || ''),
            warehouseId: String(stock.warehouseId || ''),
            pickingTypeId: String(stock.pickingTypeId || ''),
        },
        connection: {
            status: row.connection_status || 'not_configured',
            checkedAt: row.connection_checked_at,
            message: row.connection_message,
            version: row.connection_version,
        },
        updatedAt: row.updated_at,
    };
}
function saveSettings(input) {
    const existing = getSettings();
    const nextApiKey = input.keepExistingApiKey && !input.apiKey ? existing.odoo.apiKey : input.apiKey || '';
    const fieldMappings = {
        ...(0, helpers_1.createEmptyFieldMappings)(),
        ...existing.fieldMappings,
        ...input.fieldMappings,
    };
    const parser = {
        ...existing.parser,
        ...input.parser,
    };
    const scheduler = {
        ...existing.scheduler,
        ...input.scheduler,
    };
    const stock = {
        ...existing.stock,
        ...input.stock,
    };
    db_1.db.prepare(`
      UPDATE settings
      SET
        odoo_base_url = @odoo_base_url,
        odoo_database = @odoo_database,
        odoo_username = @odoo_username,
        odoo_api_key_encrypted = @odoo_api_key_encrypted,
        field_mapping_json = @field_mapping_json,
        parser_config_json = @parser_config_json,
        scheduler_config_json = @scheduler_config_json,
        stock_config_json = @stock_config_json,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run({
        odoo_base_url: input.baseUrl,
        odoo_database: input.database,
        odoo_username: input.username,
        odoo_api_key_encrypted: (0, crypto_1.encryptSecret)(nextApiKey),
        field_mapping_json: JSON.stringify(fieldMappings),
        parser_config_json: JSON.stringify(parser),
        scheduler_config_json: JSON.stringify(scheduler),
        stock_config_json: JSON.stringify(stock),
    });
    return getSettings();
}
function getCachedModelFields(modelName) {
    const row = db_1.db
        .prepare(`
        SELECT model_name, fields_json, fetched_at
        FROM odoo_model_fields_cache
        WHERE model_name = ?
      `)
        .get(modelName);
    if (!row) {
        return {
            modelName,
            fields: [],
            fetchedAt: null,
        };
    }
    return {
        modelName: row.model_name,
        fields: (0, helpers_1.safeJsonParse)(row.fields_json, []),
        fetchedAt: row.fetched_at,
    };
}
function saveCachedModelFields(modelName, fields) {
    db_1.db.prepare(`
      INSERT INTO odoo_model_fields_cache (model_name, fields_json, fetched_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(model_name) DO UPDATE SET
        fields_json = excluded.fields_json,
        fetched_at = CURRENT_TIMESTAMP
    `).run(modelName, JSON.stringify(fields));
    return getCachedModelFields(modelName);
}
function insertSchedulerRun(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT INTO scheduler_runs (
        id,
        status,
        trigger_source,
        scanned_count,
        processed_count,
        skipped_count,
        failed_count,
        summary,
        error_message,
        context_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.status, entry.trigger, entry.scannedCount || 0, entry.processedCount || 0, entry.skippedCount || 0, entry.failedCount || 0, entry.summary || null, entry.errorMessage || null, JSON.stringify(entry.context || {}));
    return getSchedulerRunById(id);
}
function updateSchedulerRun(id, patch) {
    const current = getSchedulerRunById(id);
    db_1.db.prepare(`
      UPDATE scheduler_runs
      SET
        status = @status,
        scanned_count = @scanned_count,
        processed_count = @processed_count,
        skipped_count = @skipped_count,
        failed_count = @failed_count,
        summary = @summary,
        error_message = @error_message,
        context_json = @context_json,
        finished_at = CASE WHEN @finished = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END
      WHERE id = @id
    `).run({
        id,
        status: patch.status ?? current.status,
        scanned_count: patch.scannedCount ?? current.scannedCount,
        processed_count: patch.processedCount ?? current.processedCount,
        skipped_count: patch.skippedCount ?? current.skippedCount,
        failed_count: patch.failedCount ?? current.failedCount,
        summary: patch.summary ?? current.summary,
        error_message: patch.errorMessage ?? current.errorMessage,
        context_json: JSON.stringify(patch.context ?? current.context),
        finished: patch.finished ? 1 : 0,
    });
    return getSchedulerRunById(id);
}
function getSchedulerRunById(id) {
    const row = db_1.db
        .prepare(`
        SELECT
          id,
          status,
          trigger_source,
          started_at,
          finished_at,
          scanned_count,
          processed_count,
          skipped_count,
          failed_count,
          summary,
          error_message,
          context_json
        FROM scheduler_runs
        WHERE id = ?
      `)
        .get(id);
    if (!row) {
        throw new Error(`Scheduler run ${id} was not found.`);
    }
    return {
        id: row.id,
        status: row.status,
        trigger: row.trigger_source,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        scannedCount: row.scanned_count,
        processedCount: row.processed_count,
        skippedCount: row.skipped_count,
        failedCount: row.failed_count,
        summary: row.summary,
        errorMessage: row.error_message,
        context: (0, helpers_1.safeJsonParse)(row.context_json, {}),
    };
}
function getRecentSchedulerRuns(limit = 10) {
    const rows = db_1.db
        .prepare(`
        SELECT
          id,
          status,
          trigger_source,
          started_at,
          finished_at,
          scanned_count,
          processed_count,
          skipped_count,
          failed_count,
          summary,
          error_message,
          context_json
        FROM scheduler_runs
        ORDER BY datetime(started_at) DESC, rowid DESC
        LIMIT ?
      `)
        .all(limit);
    return rows.map((row) => ({
        id: row.id,
        status: row.status,
        trigger: row.trigger_source,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        scannedCount: row.scanned_count,
        processedCount: row.processed_count,
        skippedCount: row.skipped_count,
        failedCount: row.failed_count,
        summary: row.summary,
        errorMessage: row.error_message,
        context: (0, helpers_1.safeJsonParse)(row.context_json, {}),
    }));
}
function updateConnectionStatus(status, message, version = null) {
    db_1.db.prepare(`
      UPDATE settings
      SET
        connection_status = ?,
        connection_checked_at = CURRENT_TIMESTAMP,
        connection_message = ?,
        connection_version = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(status, message, version);
}
function insertLog(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT INTO logs (id, history_id, level, message, context_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, entry.historyId || null, entry.level, entry.message, JSON.stringify(entry.context || {}));
    return id;
}
function getRecentLogs(limit = 50, historyId) {
    const statement = historyId
        ? db_1.db.prepare(`
          SELECT id, history_id, level, message, context_json, created_at
          FROM logs
          WHERE history_id = ?
          ORDER BY datetime(created_at) DESC, rowid DESC
          LIMIT ?
        `)
        : db_1.db.prepare(`
          SELECT id, history_id, level, message, context_json, created_at
          FROM logs
          ORDER BY datetime(created_at) DESC, rowid DESC
          LIMIT ?
        `);
    const rows = (historyId ? statement.all(historyId, limit) : statement.all(limit));
    return rows.map((row) => ({
        id: row.id,
        historyId: row.history_id,
        level: row.level,
        message: row.message,
        context: (0, helpers_1.safeJsonParse)(row.context_json, {}),
        createdAt: row.created_at,
    }));
}
function insertHistory(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT INTO history (
        id,
        order_id,
        order_name,
        attachment_id,
        attachment_name,
        status,
        summary,
        error_message,
        computed_signature,
        stored_signature,
        signature_comparison,
        send_skipped,
        signature_written
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.orderId, entry.orderName, entry.attachmentId, entry.attachmentName, entry.status, entry.summary || null, entry.errorMessage || null, entry.computedSignature || null, entry.storedSignature || null, entry.signatureComparison || null, entry.sendSkipped ? 1 : 0, entry.signatureWritten ? 1 : 0);
    return getHistoryById(id);
}
function updateHistory(id, patch) {
    const current = getHistoryById(id);
    db_1.db.prepare(`
      UPDATE history
      SET
        status = @status,
        summary = @summary,
        error_message = @error_message,
        extracted_result_id = @extracted_result_id,
        computed_signature = @computed_signature,
        stored_signature = @stored_signature,
        signature_comparison = @signature_comparison,
        send_skipped = @send_skipped,
        signature_written = @signature_written,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
        id,
        status: patch.status ?? current.status,
        summary: patch.summary ?? current.summary,
        error_message: patch.errorMessage ?? current.errorMessage,
        extracted_result_id: patch.extractedResultId ?? current.extractedResultId,
        computed_signature: patch.computedSignature ?? current.computedSignature,
        stored_signature: patch.storedSignature ?? current.storedSignature,
        signature_comparison: patch.signatureComparison ?? current.signatureComparison,
        send_skipped: (patch.sendSkipped ?? current.sendSkipped) ? 1 : 0,
        signature_written: (patch.signatureWritten ?? current.signatureWritten) ? 1 : 0,
    });
    return getHistoryById(id);
}
function getHistoryById(id) {
    const row = db_1.db
        .prepare(`
        SELECT
          id,
          order_id,
          order_name,
          attachment_id,
          attachment_name,
          status,
          summary,
          error_message,
          extracted_result_id,
          computed_signature,
          stored_signature,
          signature_comparison,
          send_skipped,
          signature_written,
          created_at,
          updated_at
        FROM history
        WHERE id = ?
      `)
        .get(id);
    if (!row) {
        throw new Error(`History entry ${id} was not found.`);
    }
    return {
        id: row.id,
        orderId: row.order_id,
        orderName: row.order_name,
        attachmentId: row.attachment_id,
        attachmentName: row.attachment_name,
        status: row.status,
        summary: row.summary,
        errorMessage: row.error_message,
        extractedResultId: row.extracted_result_id,
        computedSignature: row.computed_signature,
        storedSignature: row.stored_signature,
        signatureComparison: row.signature_comparison,
        sendSkipped: Boolean(row.send_skipped),
        signatureWritten: Boolean(row.signature_written),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function getRecentHistory(limit = 20, orderId) {
    const statement = orderId
        ? db_1.db.prepare(`
          SELECT
            id,
            order_id,
            order_name,
            attachment_id,
            attachment_name,
            status,
            summary,
            error_message,
            extracted_result_id,
            computed_signature,
            stored_signature,
            signature_comparison,
            send_skipped,
            signature_written,
            created_at,
            updated_at
          FROM history
          WHERE order_id = ?
          ORDER BY datetime(created_at) DESC, rowid DESC
          LIMIT ?
        `)
        : db_1.db.prepare(`
          SELECT
            id,
            order_id,
            order_name,
            attachment_id,
            attachment_name,
            status,
            summary,
            error_message,
            extracted_result_id,
            computed_signature,
            stored_signature,
            signature_comparison,
            send_skipped,
            signature_written,
            created_at,
            updated_at
          FROM history
          ORDER BY datetime(created_at) DESC, rowid DESC
          LIMIT ?
        `);
    const rows = (orderId ? statement.all(orderId, limit) : statement.all(limit));
    return rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderName: row.order_name,
        attachmentId: row.attachment_id,
        attachmentName: row.attachment_name,
        status: row.status,
        summary: row.summary,
        errorMessage: row.error_message,
        extractedResultId: row.extracted_result_id,
        computedSignature: row.computed_signature,
        storedSignature: row.stored_signature,
        signatureComparison: row.signature_comparison,
        sendSkipped: Boolean(row.send_skipped),
        signatureWritten: Boolean(row.signature_written),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}
function insertExtractedResult(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT INTO extracted_results (
        id,
        history_id,
        order_id,
        order_name,
        attachment_id,
        attachment_name,
        result_json,
        raw_text,
        pdf_signature
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.historyId, entry.orderId, entry.orderName, entry.attachmentId, entry.attachmentName, JSON.stringify(entry.resultJson), entry.rawText, entry.pdfSignature || null);
    updateHistory(entry.historyId, { extractedResultId: id });
    return getExtractedResultByHistoryId(entry.historyId);
}
function getExtractedResultByHistoryId(historyId) {
    const row = db_1.db
        .prepare(`
        SELECT
          id,
          history_id,
          order_id,
          order_name,
          attachment_id,
          attachment_name,
          result_json,
          raw_text,
          pdf_signature,
          created_at
        FROM extracted_results
        WHERE history_id = ?
      `)
        .get(historyId);
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        historyId: row.history_id,
        orderId: row.order_id,
        orderName: row.order_name,
        attachmentId: row.attachment_id,
        attachmentName: row.attachment_name,
        resultJson: (0, helpers_1.safeJsonParse)(row.result_json, {
            items: [],
            sectionFound: false,
            sectionText: '',
            rawText: '',
            logs: [],
        }),
        rawText: row.raw_text,
        pdfSignature: row.pdf_signature,
        createdAt: row.created_at,
    };
}
function getLatestExtractedResultByOrderId(orderId) {
    const row = db_1.db
        .prepare(`
        SELECT
          extracted_results.id,
          extracted_results.history_id,
          extracted_results.order_id,
          extracted_results.order_name,
          extracted_results.attachment_id,
          extracted_results.attachment_name,
          extracted_results.result_json,
          extracted_results.raw_text,
          extracted_results.pdf_signature,
          extracted_results.created_at
        FROM extracted_results
        INNER JOIN history ON history.id = extracted_results.history_id
        WHERE extracted_results.order_id = ?
        ORDER BY datetime(history.updated_at) DESC, history.rowid DESC
        LIMIT 1
      `)
        .get(orderId);
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        historyId: row.history_id,
        orderId: row.order_id,
        orderName: row.order_name,
        attachmentId: row.attachment_id,
        attachmentName: row.attachment_name,
        resultJson: (0, helpers_1.safeJsonParse)(row.result_json, {
            items: [],
            sectionFound: false,
            sectionText: '',
            rawText: '',
            logs: [],
        }),
        rawText: row.raw_text,
        pdfSignature: row.pdf_signature,
        createdAt: row.created_at,
    };
}
function getProcessedStockVariantIds(orderId, extractionSignature) {
    const rows = db_1.db
        .prepare(`
        SELECT spi.variant_id
        FROM stock_processed_items spi
        LEFT JOIN stock_reversed_items sri ON sri.processed_item_id = spi.id
        WHERE spi.order_id = ? AND spi.extraction_signature = ? AND sri.processed_item_id IS NULL
      `)
        .all(orderId, extractionSignature);
    return rows.map((row) => row.variant_id);
}
function getUnreversedProcessedStockItemsForOrder(orderId) {
    const rows = db_1.db
        .prepare(`
        SELECT
          spi.id,
          spi.order_id,
          spi.extraction_signature,
          spi.variant_id,
          spi.normalized_color,
          spi.quantity_added_meters,
          spi.history_id,
          spi.created_at
        FROM stock_processed_items spi
        LEFT JOIN stock_reversed_items sri ON sri.processed_item_id = spi.id
        WHERE spi.order_id = ? AND sri.processed_item_id IS NULL
        ORDER BY datetime(spi.created_at) DESC, spi.rowid DESC
      `)
        .all(orderId);
    return rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        extractionSignature: row.extraction_signature,
        variantId: row.variant_id,
        normalizedColor: row.normalized_color,
        quantityAddedMeters: row.quantity_added_meters,
        historyId: row.history_id,
        createdAt: row.created_at,
    }));
}
function insertProcessedStockItem(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT OR IGNORE INTO stock_processed_items (
        id,
        order_id,
        extraction_signature,
        variant_id,
        normalized_color,
        quantity_added_meters,
        history_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.orderId, entry.extractionSignature, entry.variantId, entry.normalizedColor, entry.quantityAddedMeters, entry.historyId || null);
}
function markProcessedStockItemReversed(processedItemId, orderId) {
    db_1.db.prepare(`
      INSERT OR IGNORE INTO stock_reversed_items (
        processed_item_id,
        order_id
      )
      VALUES (?, ?)
    `).run(processedItemId, orderId);
}
function acquireStockProcessingLock(orderId, extractionSignature) {
    db_1.db.prepare(`
      DELETE FROM stock_processing_locks
      WHERE datetime(acquired_at) < datetime('now', '-2 hours')
    `).run();
    const lockKey = `${orderId}:${extractionSignature}`;
    const result = db_1.db
        .prepare(`
        INSERT OR IGNORE INTO stock_processing_locks (
          lock_key,
          order_id,
          extraction_signature
        )
        VALUES (?, ?, ?)
      `)
        .run(lockKey, orderId, extractionSignature);
    return result.changes > 0;
}
function releaseStockProcessingLock(orderId, extractionSignature) {
    const lockKey = `${orderId}:${extractionSignature}`;
    db_1.db.prepare(`
      DELETE FROM stock_processing_locks
      WHERE lock_key = ?
    `).run(lockKey);
}
function isStockProcessingLocked(orderId, extractionSignature) {
    const lockKey = `${orderId}:${extractionSignature}`;
    const row = db_1.db
        .prepare(`
        SELECT lock_key
        FROM stock_processing_locks
        WHERE lock_key = ?
      `)
        .get(lockKey);
    return Boolean(row);
}
function insertAuthLoginChallenge(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT INTO auth_login_challenges (
        id,
        email,
        code_hash,
        redirect_path,
        expires_at,
        attempts_remaining,
        requested_ip
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.email, entry.codeHash, entry.redirectPath, entry.expiresAt, entry.attemptsRemaining, entry.requestedIp || null);
    return id;
}
function getLatestActiveAuthLoginChallenge(email) {
    const row = db_1.db
        .prepare(`
        SELECT
          id,
          email,
          code_hash,
          redirect_path,
          expires_at,
          attempts_remaining,
          consumed_at,
          requested_ip,
          created_at
        FROM auth_login_challenges
        WHERE email = ?
          AND consumed_at IS NULL
          AND datetime(expires_at) >= datetime('now')
        ORDER BY datetime(created_at) DESC, rowid DESC
        LIMIT 1
      `)
        .get(email);
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        email: row.email,
        codeHash: row.code_hash,
        redirectPath: row.redirect_path,
        expiresAt: row.expires_at,
        attemptsRemaining: row.attempts_remaining,
        consumedAt: row.consumed_at,
        requestedIp: row.requested_ip,
        createdAt: row.created_at,
    };
}
function updateAuthLoginChallenge(id, patch) {
    const current = db_1.db
        .prepare(`
        SELECT attempts_remaining, consumed_at
        FROM auth_login_challenges
        WHERE id = ?
      `)
        .get(id);
    if (!current) {
        return;
    }
    db_1.db.prepare(`
      UPDATE auth_login_challenges
      SET
        attempts_remaining = ?,
        consumed_at = CASE
          WHEN ? = 1 THEN COALESCE(consumed_at, CURRENT_TIMESTAMP)
          ELSE consumed_at
        END
      WHERE id = ?
    `).run(patch.attemptsRemaining ?? current.attempts_remaining, patch.consumed ? 1 : 0, id);
}
function consumeAllAuthChallengesForEmail(email) {
    db_1.db.prepare(`
      UPDATE auth_login_challenges
      SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
      WHERE email = ? AND consumed_at IS NULL
    `).run(email);
}
function insertAuthSession(entry) {
    const id = (0, uuid_1.v4)();
    db_1.db.prepare(`
      INSERT INTO auth_sessions (
        id,
        email,
        csrf_token,
        user_agent_hash,
        ip_address,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entry.email, entry.csrfToken, entry.userAgentHash, entry.ipAddress || null, entry.expiresAt);
    return id;
}
function getAuthSession(id) {
    const row = db_1.db
        .prepare(`
        SELECT
          id,
          email,
          csrf_token,
          user_agent_hash,
          ip_address,
          expires_at,
          revoked_at,
          created_at,
          last_seen_at
        FROM auth_sessions
        WHERE id = ?
      `)
        .get(id);
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        user: {
            email: row.email,
        },
        csrfToken: row.csrf_token,
        userAgentHash: row.user_agent_hash,
        ipAddress: row.ip_address,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
    };
}
function touchAuthSession(id, expiresAt) {
    db_1.db.prepare(`
      UPDATE auth_sessions
      SET
        expires_at = ?,
        last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `).run(expiresAt, id);
}
function revokeAuthSession(id) {
    db_1.db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).run(id);
}
function revokeExpiredAuthSessions() {
    db_1.db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE revoked_at IS NULL AND datetime(expires_at) < datetime('now')
    `).run();
}
function insertAuthAttempt(entry) {
    db_1.db.prepare(`
      INSERT INTO auth_attempts (
        id,
        scope,
        email,
        ip_address,
        success
      )
      VALUES (?, ?, ?, ?, ?)
    `).run((0, uuid_1.v4)(), entry.scope, entry.email || null, entry.ipAddress || null, entry.success ? 1 : 0);
}
function countRecentAuthAttempts(scope, windowMinutes, filters = {}) {
    const conditions = [`scope = @scope`, `datetime(created_at) >= datetime('now', @window)`];
    const parameters = {
        scope,
        window: `-${Math.max(1, windowMinutes)} minutes`,
    };
    if (filters.email) {
        conditions.push(`email = @email`);
        parameters.email = filters.email;
    }
    if (filters.ipAddress) {
        conditions.push(`ip_address = @ip_address`);
        parameters.ip_address = filters.ipAddress;
    }
    const row = db_1.db
        .prepare(`
        SELECT COUNT(*) as attempt_count
        FROM auth_attempts
        WHERE ${conditions.join(' AND ')}
      `)
        .get(parameters);
    return row.attempt_count || 0;
}
