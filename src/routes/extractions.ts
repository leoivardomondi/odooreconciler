import { Router } from 'express';
import {
  compareExtractionSignature,
  sendExtractedResultToOdoo,
  getExtractionViewModel,
} from '../services/extractionService';

const router = Router();

router.get('/extractions/:historyId', async (req, res) => {
  const { historyId } = req.params;
  const message = typeof req.query.message === 'string' ? req.query.message : '';
  const warning = typeof req.query.warning === 'string' ? req.query.warning : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';

  try {
    const model = await getExtractionViewModel(historyId);

    res.render('extraction-view', {
      pageTitle: `Extraction ${model.history.orderName}`,
      model,
      status: message
        ? { type: 'success', message }
        : warning
          ? { type: 'warning', message: warning }
        : error
          ? { type: 'danger', message: error }
          : null,
    });
  } catch (caughtError) {
    const details =
      caughtError instanceof Error ? caughtError.message : 'Could not load the extraction.';
    res.status(404).render('error', {
      pageTitle: 'Extraction Not Found',
      errorMessage: details,
      details: [],
    });
  }
});

router.post('/extractions/:historyId/compare-signature', async (req, res) => {
  const { historyId } = req.params;

  try {
    const result = await compareExtractionSignature(historyId);
    const message =
      result.comparisonResult === 'match'
        ? 'This Job Summary PDF appears unchanged based on signature.'
        : result.comparisonResult === 'different'
          ? 'The current PDF signature is different from the signature stored in Odoo.'
          : result.canCompare
            ? 'No stored Odoo signature was found for this Sales Order.'
            : 'Signature field is missing or unavailable in Odoo.';
    const queryKey = result.comparisonResult === 'different' ? 'message' : 'warning';
    res.redirect(`/extractions/${historyId}?${queryKey}=${encodeURIComponent(message)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not compare the signature.';
    res.redirect(`/extractions/${historyId}?error=${encodeURIComponent(message)}`);
  }
});

router.post('/extractions/:historyId/send-to-odoo', async (req, res) => {
  const { historyId } = req.params;
  const forceSend = req.body.forceSend === 'true';

  try {
    const result = await sendExtractedResultToOdoo(historyId, forceSend);
    res.redirect(
      `/extractions/${historyId}?${
        result.warningMessage
          ? `warning=${encodeURIComponent(result.warningMessage)}`
          : `message=${encodeURIComponent(result.skipped ? 'Send was skipped because the signature matched Odoo.' : 'Extracted data was sent to Odoo successfully.')}`
      }`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not send data to Odoo.';
    res.redirect(`/extractions/${historyId}?error=${encodeURIComponent(message)}`);
  }
});

export default router;
