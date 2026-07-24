import { Router } from 'express';
import { getLatestPoBillProcessedDocumentsByPurchaseOrderIds, getSettings } from '../models/repositories';
import { PurchaseOrderListItem } from '../models/types';
import { OdooClient } from '../services/odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';

const router = Router();

async function buildClient() {
  const settings = await getSettings();

  if (!hasOdooConfiguration(settings)) {
    throw new Error('Odoo is not configured yet. Complete setup first.');
  }

  return new OdooClient({
    baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
    database: settings.odoo.database,
    username: settings.odoo.username,
    apiKey: settings.odoo.apiKey,
  });
}

function currentYearStartDate() {
  return `${new Date().getFullYear()}-01-01`;
}

function buildPurchaseOrderQuerySuffix(query: {
  q: string;
  fromDate: string;
  toDate: string;
  page?: number;
  load?: boolean;
}) {
  const params = [];
  if (query.load) {
    params.push('load=1');
  }
  if (query.q) {
    params.push(`q=${encodeURIComponent(query.q)}`);
  }
  if (query.fromDate) {
    params.push(`from=${encodeURIComponent(query.fromDate)}`);
  }
  if (query.toDate) {
    params.push(`to=${encodeURIComponent(query.toDate)}`);
  }
  if (query.page && query.page > 1) {
    params.push(`page=${query.page}`);
  }
  return params.length ? `?${params.join('&')}` : '';
}

async function buildPurchaseOrderListItems(
  orderSummaries: Awaited<ReturnType<OdooClient['searchPurchaseOrders']>>,
): Promise<PurchaseOrderListItem[]> {
  const processedByPoId = await getLatestPoBillProcessedDocumentsByPurchaseOrderIds(
    orderSummaries.map((order) => order.id),
  );

  return orderSummaries.map((order) => {
    const processed = processedByPoId[order.id] || null;

    return {
      ...order,
      appStatus: {
        hasAutomationRun: Boolean(processed),
        status: processed?.status || 'not_processed',
        matchedDocumentName: processed?.attachmentName || null,
        vendorBillName: processed?.vendorBillName || null,
        processedAt: processed?.processedAt || null,
        summary: processed?.summary || null,
      },
    };
  });
}

router.get('/purchase-orders', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const hasExplicitFromDate = typeof req.query.from === 'string';
  const hasExplicitToDate = typeof req.query.to === 'string';
  const fromDate = String(req.query.from || currentYearStartDate()).trim();
  const toDate = String(req.query.to || '').trim();
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = 25;
  const offset = (page - 1) * pageSize;
  const shouldLoad =
    req.query.load === '1' || query.length > 0 || hasExplicitFromDate || hasExplicitToDate || page > 1;

  if (!shouldLoad) {
    res.render('purchase-orders', {
      pageTitle: 'Purchase Orders',
      query,
      fromDate,
      toDate,
      orders: [],
      page,
      hasPreviousPage: false,
      hasNextPage: false,
      hasLoaded: false,
      buildPurchaseOrderQuerySuffix,
      status: null,
    });
    return;
  }

  try {
    const client = await buildClient();
    const orderSummaries = await client.searchPurchaseOrders({
      searchTerm: query,
      fromDate,
      toDate,
      limit: pageSize + 1,
      offset,
    });
    const hasNextPage = orderSummaries.length > pageSize;
    const orders = await buildPurchaseOrderListItems(orderSummaries.slice(0, pageSize));

    res.render('purchase-orders', {
      pageTitle: 'Purchase Orders',
      query,
      fromDate,
      toDate,
      orders,
      page,
      hasPreviousPage: page > 1,
      hasNextPage,
      hasLoaded: true,
      buildPurchaseOrderQuerySuffix,
      status: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Purchase Orders.';
    res.status(500).render('purchase-orders', {
      pageTitle: 'Purchase Orders',
      query,
      fromDate,
      toDate,
      orders: [],
      page,
      hasPreviousPage: page > 1,
      hasNextPage: false,
      hasLoaded: true,
      buildPurchaseOrderQuerySuffix,
      status: { type: 'danger', message },
    });
  }
});

export default router;
