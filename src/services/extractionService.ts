import {
  getExtractedResultByHistoryId,
  getHistoryById,
  getRecentHistory,
  getSettings,
  insertExtractedResult,
  insertHistory,
  updateHistory,
} from '../models/repositories';
import {
  ExtractionViewModel,
  OdooModelField,
  SignatureComparisonResult,
  SignatureDisplayState,
} from '../models/types';
import {
  buildProcessingLog,
  formatOdooDateTime,
  getMissingFieldMappingLabels,
  hasOdooConfiguration,
  isJobSummaryAttachment,
  isPdfAttachment,
  resolveFieldMappings,
  resolveSignatureFieldMapping,
  renderTemplate,
  sortAttachmentsNewestFirst,
  truncate,
} from '../utils/helpers';
import { logEvent, fetchRecentLogsAsync } from './logService';
import { OdooClient } from './odooClient';
import { parseJobSummaryPdf } from './pdfParser';
import {
  compareSignature,
  computePdfSignature,
  getSignatureComparisonLabel,
} from './signatureService';

async function getConfiguredClient() {
  const settings = await getSettings();

  if (!hasOdooConfiguration(settings)) {
    throw new Error('Odoo is not configured yet. Complete the setup page first.');
  }

  return {
    client: new OdooClient(settings.odoo),
    settings,
  };
}

async function getSignatureContext(
  client: OdooClient,
  orderId: number,
  settingsFieldMappings: Awaited<ReturnType<typeof getSettings>>['fieldMappings'],
  computedSignature: string | null,
  availableFields?: OdooModelField[],
) {
  const fields = availableFields || (await client.getSaleOrderFields());
  const resolvedMappings = resolveFieldMappings(settingsFieldMappings, fields);
  const signatureField = resolveSignatureFieldMapping(resolvedMappings);
  const signatureFieldMeta = fields.find((field) => field.name === signatureField) || null;

  if (!signatureField || !signatureFieldMeta) {
    return {
      availableFields: fields,
      signatureField: '',
      signatureFieldType: '',
      storedSignature: null,
      comparisonResult: null as SignatureComparisonResult | null,
      comparisonLabel: 'SIGNATURE FIELD NOT CONFIGURED',
      canCompare: false,
      canForceSend: false,
      shouldSkipDefaultSend: false,
      warningMessage: 'Signature field is missing or unavailable in Odoo.',
    };
  }

  const values = await client.readSaleOrderFields(orderId, [signatureField]);
  const storedSignature = values[signatureField] ? String(values[signatureField]) : null;
  const comparisonResult = compareSignature(computedSignature, storedSignature);

  return {
    availableFields: fields,
    signatureField,
    signatureFieldType: signatureFieldMeta.type,
    storedSignature,
    comparisonResult,
    comparisonLabel: getSignatureComparisonLabel(comparisonResult),
    canCompare: true,
    canForceSend: comparisonResult === 'match',
    shouldSkipDefaultSend: comparisonResult === 'match',
    warningMessage:
      comparisonResult === 'match'
        ? 'This Job Summary PDF appears unchanged based on signature.'
        : comparisonResult === 'missing'
          ? 'No stored Odoo signature was found for this Sales Order.'
          : '',
  };
}

export async function extractLatestJobSummaryForOrder(orderId: number) {
  const { client, settings } = await getConfiguredClient();
  const order = await client.getSaleOrder(orderId);
  const attachments = await client.getAttachments(orderId);
  const target = attachments
    .filter((attachment) => isJobSummaryAttachment(attachment, settings.parser.filenameKeyword))
    .sort(sortAttachmentsNewestFirst)[0];

  if (!target) {
    throw new Error(
      `No PDF attachment matching "${settings.parser.filenameKeyword}" was found for ${order.name}.`,
    );
  }

  return extractAttachmentForOrder(orderId, target.id);
}

export async function extractAttachmentForOrder(orderId: number, attachmentId: number) {
  const { client, settings } = await getConfiguredClient();
  const order = await client.getSaleOrder(orderId);
  const attachments = await client.getAttachments(orderId);
  const selectedAttachment = attachments.find((attachment) => attachment.id === attachmentId);

  if (!selectedAttachment) {
    throw new Error(`Attachment ${attachmentId} was not found on ${order.name}.`);
  }

  if (!isPdfAttachment(selectedAttachment)) {
    throw new Error(`Attachment "${selectedAttachment.name}" is not a PDF.`);
  }

  const history = await insertHistory({
    orderId,
    orderName: order.name,
    attachmentId: selectedAttachment.id,
    attachmentName: selectedAttachment.name,
    status: 'started',
    summary: 'Extraction started.',
    sendSkipped: false,
    signatureWritten: false,
  });

  await logEvent(
    'info',
    'Extraction started',
    {
      orderId,
      orderName: order.name,
      attachmentId: selectedAttachment.id,
      attachmentName: selectedAttachment.name,
    },
    history.id,
  );

  try {
    const downloaded = await client.downloadAttachment(selectedAttachment.id);
    const computedSignature = computePdfSignature(downloaded.content);
    const signatureContext = await getSignatureContext(
      client,
      orderId,
      settings.fieldMappings,
      computedSignature,
    );

    await logEvent(
      'info',
      'Attachment downloaded from Odoo',
      {
        attachmentId: downloaded.id,
        attachmentName: downloaded.name,
        fileSize: downloaded.fileSize,
        computedSignature,
        storedOdooSignature: signatureContext.storedSignature,
        signatureComparison: signatureContext.comparisonResult,
      },
      history.id,
    );

    const parsed = await parseJobSummaryPdf(downloaded.content, settings.parser);
    const summary = parsed.items.length
      ? `Extracted ${parsed.items.length} edging item(s).`
      : 'No edging items were found in the Job Summary section.';

    await insertExtractedResult({
      historyId: history.id,
      orderId,
      orderName: order.name,
      attachmentId: selectedAttachment.id,
      attachmentName: selectedAttachment.name,
      resultJson: parsed,
      rawText: parsed.rawText,
      pdfSignature: computedSignature,
    });

    await updateHistory(history.id, {
      status: parsed.items.length ? 'parsed' : 'parsed_empty',
      summary,
      errorMessage: null,
      computedSignature,
      storedSignature: signatureContext.storedSignature,
      signatureComparison: signatureContext.comparisonResult,
      sendSkipped: false,
      signatureWritten: false,
    });

    await logEvent(
      'info',
      'PDF parsing completed',
      {
        historyId: history.id,
        itemsExtracted: parsed.items.length,
        sectionFound: parsed.sectionFound,
        parserLogs: parsed.logs,
        attachmentId: selectedAttachment.id,
        attachmentName: selectedAttachment.name,
        computedSignature,
        storedOdooSignature: signatureContext.storedSignature,
        signatureComparison: signatureContext.comparisonResult,
      },
      history.id,
    );

    return getHistoryById(history.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown extraction failure.';

    await updateHistory(history.id, {
      status: 'failed',
      summary: 'Extraction failed.',
      errorMessage: message,
      sendSkipped: false,
      signatureWritten: false,
    });

    await logEvent(
      'error',
      'Extraction failed',
      {
        historyId: history.id,
        error: message,
      },
      history.id,
    );

    throw error;
  }
}

export async function compareExtractionSignature(historyId: string) {
  const { client, settings } = await getConfiguredClient();
  const history = await getHistoryById(historyId);
  const extracted = await getExtractedResultByHistoryId(historyId);

  if (!extracted) {
    throw new Error(`No extracted JSON is stored for history entry ${historyId}.`);
  }

  const signatureContext = await getSignatureContext(
    client,
    history.orderId,
    settings.fieldMappings,
    extracted.pdfSignature,
  );

  await updateHistory(historyId, {
    computedSignature: extracted.pdfSignature,
    storedSignature: signatureContext.storedSignature,
    signatureComparison: signatureContext.comparisonResult,
  });

  await logEvent(
    'info',
    'Signature compared against Odoo',
    {
      historyId,
      orderId: history.orderId,
      attachmentId: history.attachmentId,
      attachmentName: history.attachmentName,
      computedSignature: extracted.pdfSignature,
      storedOdooSignature: signatureContext.storedSignature,
      comparisonResult: signatureContext.comparisonResult,
      signatureField: signatureContext.signatureField,
    },
    historyId,
  );

  return signatureContext;
}

export async function sendExtractedResultToOdoo(historyId: string, forceSend = false) {
  const { client, settings } = await getConfiguredClient();
  const history = await getHistoryById(historyId);
  const extracted = await getExtractedResultByHistoryId(historyId);

  if (!extracted) {
    throw new Error(`No extracted JSON is stored for history entry ${historyId}.`);
  }

  const availableFields = await client.getSaleOrderFields();
  const resolvedMappings = resolveFieldMappings(settings.fieldMappings, availableFields);
  const missingMappings = getMissingFieldMappingLabels(resolvedMappings);
  const signatureContext = await getSignatureContext(
    client,
    history.orderId,
    settings.fieldMappings,
    extracted.pdfSignature,
    availableFields,
  );
  const processedAt = formatOdooDateTime(new Date());
  const itemsCount = extracted.resultJson.items.length;
  const updatePayload: Record<string, unknown> = {};

  if (signatureContext.shouldSkipDefaultSend && !forceSend) {
    await updateHistory(historyId, {
      status: 'signature_unchanged_skipped',
      summary: 'Skipped send because the Job Summary PDF signature matches Odoo.',
      errorMessage: null,
      computedSignature: extracted.pdfSignature,
      storedSignature: signatureContext.storedSignature,
      signatureComparison: signatureContext.comparisonResult,
      sendSkipped: true,
      signatureWritten: false,
    });

    await logEvent(
      'warn',
      'Send to Odoo skipped because the PDF signature matched the stored Odoo signature',
      {
        historyId,
        orderId: history.orderId,
        attachmentId: history.attachmentId,
        attachmentName: history.attachmentName,
        computedSignature: extracted.pdfSignature,
        storedOdooSignature: signatureContext.storedSignature,
        comparisonResult: signatureContext.comparisonResult,
        forceSend,
        skipped: true,
      },
      historyId,
    );

    return {
      history: await getHistoryById(historyId),
      warningMessage: 'This Job Summary PDF appears unchanged based on signature.',
      missingMappings,
      writeResult: null,
      skipped: true,
    };
  }

  if (resolvedMappings.previousJsonField && resolvedMappings.edgeJsonField) {
    const currentValues = await client.readSaleOrderFields(history.orderId, [
      resolvedMappings.edgeJsonField,
    ]);
    const currentJson = currentValues[resolvedMappings.edgeJsonField];

    if (currentJson !== null && currentJson !== undefined && String(currentJson).trim()) {
      updatePayload[resolvedMappings.previousJsonField] = String(currentJson);
    }
  }

  if (resolvedMappings.edgeJsonField) {
    updatePayload[resolvedMappings.edgeJsonField] = JSON.stringify(extracted.resultJson);
  }

  if (resolvedMappings.logField) {
    updatePayload[resolvedMappings.logField] = buildProcessingLog(
      extracted.resultJson,
      history.attachmentName,
      history.id,
    );
  }

  if (resolvedMappings.processedField) {
    updatePayload[resolvedMappings.processedField] = true;
  }

  if (resolvedMappings.processedAtField) {
    updatePayload[resolvedMappings.processedAtField] = processedAt;
  }

  if (resolvedMappings.attachmentNameField) {
    updatePayload[resolvedMappings.attachmentNameField] = history.attachmentName;
  }

  if (resolvedMappings.attachmentIdField) {
    updatePayload[resolvedMappings.attachmentIdField] = Number(history.attachmentId);
  }

  if (resolvedMappings.signatureField && extracted.pdfSignature) {
    updatePayload[resolvedMappings.signatureField] = extracted.pdfSignature;
  }

  try {
    const result = await client.safeUpdateSaleOrder(history.orderId, updatePayload, availableFields);
    const signatureWritten = Boolean(
      resolvedMappings.signatureField &&
        result.sentFields.includes(resolvedMappings.signatureField),
    );

    if (!result.success) {
      throw new Error(
        result.errorType === 'access_denied'
          ? 'Odoo denied access when updating the Sale Order.'
          : result.errorType === 'network_error'
            ? 'Network error while updating the Sale Order in Odoo.'
            : result.message,
      );
    }

    await logEvent(
      'info',
      'Structured data sent to Odoo',
      {
        historyId,
        orderId: history.orderId,
        attachmentId: history.attachmentId,
        attachmentName: history.attachmentName,
        fieldsUpdated: result.sentFields,
        skippedFields: result.skippedFields,
        missingMappings,
        computedSignature: extracted.pdfSignature,
        storedOdooSignature: signatureContext.storedSignature,
        comparisonResult: signatureContext.comparisonResult,
        forceSend,
        signatureWritten,
      },
      historyId,
    );

    if (result.skippedFields.length > 0 || missingMappings.length > 0) {
      await logEvent(
        'warn',
        'Some sale.order fields were skipped before writing to Odoo',
        {
          historyId,
          orderId: history.orderId,
          skippedFields: result.skippedFields,
          missingMappings,
        },
        historyId,
      );
    }

    if (settings.parser.postChatterOnSuccess) {
      const chatterMessage = renderTemplate(settings.parser.chatterTemplate, {
        attachmentName: history.attachmentName,
        processedAt,
        itemCount: itemsCount,
        orderName: history.orderName,
      });
      await client.postChatterMessage(history.orderId, chatterMessage);
    }

    await updateHistory(historyId, {
      status: 'sent_to_odoo',
      summary:
        result.sentFields.length > 0
          ? `Sent ${itemsCount} extracted item(s) to Odoo${result.skippedFields.length || missingMappings.length ? ' with warnings' : ''}.`
          : 'No valid Odoo fields were available, so nothing was written.',
      errorMessage: null,
      computedSignature: extracted.pdfSignature,
      storedSignature: signatureWritten ? extracted.pdfSignature : signatureContext.storedSignature,
      signatureComparison: signatureContext.comparisonResult,
      sendSkipped: false,
      signatureWritten,
    });

    return {
      history: await getHistoryById(historyId),
      warningMessage:
        result.skippedFields.length > 0 || missingMappings.length > 0
          ? 'Some fields were skipped because they do not exist in Odoo.'
          : '',
      missingMappings,
      writeResult: result,
      skipped: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Odoo update failure.';

    await updateHistory(historyId, {
      status: 'odoo_update_failed',
      summary: 'Sending data to Odoo failed.',
      errorMessage: truncate(message, 500),
      computedSignature: extracted.pdfSignature,
      storedSignature: signatureContext.storedSignature,
      signatureComparison: signatureContext.comparisonResult,
      sendSkipped: false,
      signatureWritten: false,
    });

    await logEvent(
      'error',
      'Failed to send extracted data to Odoo',
      {
        historyId,
        orderId: history.orderId,
        attachmentId: history.attachmentId,
        attachmentName: history.attachmentName,
        computedSignature: extracted.pdfSignature,
        storedOdooSignature: signatureContext.storedSignature,
        comparisonResult: signatureContext.comparisonResult,
        forceSend,
        error: message,
      },
      historyId,
    );

    throw error;
  }
}

export async function getExtractionViewModel(historyId: string): Promise<ExtractionViewModel> {
  const history = await getHistoryById(historyId);
  const result = await getExtractedResultByHistoryId(historyId);
  const logs = await fetchRecentLogsAsync(100, historyId);
  let signature: SignatureDisplayState = {
    signatureField: '',
    signatureFieldType: '',
    computedSignature: result?.pdfSignature || history.computedSignature,
    storedSignature: history.storedSignature,
    comparisonResult: history.signatureComparison,
    comparisonLabel: getSignatureComparisonLabel(history.signatureComparison),
    canCompare: false,
    canForceSend: false,
    shouldSkipDefaultSend: false,
    warningMessage: 'Signature field is missing or unavailable in Odoo.',
  };

  if (result) {
    try {
      const { client, settings } = await getConfiguredClient();
      const signatureContext = await getSignatureContext(
        client,
        history.orderId,
        settings.fieldMappings,
        result.pdfSignature,
      );

      await updateHistory(historyId, {
        computedSignature: result.pdfSignature,
        storedSignature: signatureContext.storedSignature,
        signatureComparison: signatureContext.comparisonResult,
      });

      signature = {
        signatureField: signatureContext.signatureField,
        signatureFieldType: signatureContext.signatureFieldType,
        computedSignature: result.pdfSignature,
        storedSignature: signatureContext.storedSignature,
        comparisonResult: signatureContext.comparisonResult,
        comparisonLabel: signatureContext.comparisonLabel,
        canCompare: signatureContext.canCompare,
        canForceSend: signatureContext.canForceSend,
        shouldSkipDefaultSend: signatureContext.shouldSkipDefaultSend,
        warningMessage: signatureContext.warningMessage,
      };
    } catch {
      signature = {
        ...signature,
        comparisonLabel: getSignatureComparisonLabel(signature.comparisonResult),
      };
    }
  }

  return {
    history: await getHistoryById(historyId),
    result,
    logs,
    signature,
  };
}

export function getRecentOrderHistory(orderId: number) {
  return getRecentHistory(10, orderId);
}
