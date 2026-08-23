import axios, { AxiosError } from 'axios';
import {
  AttachmentInfo,
  CustomerInvoiceSummary,
  CustomerPaymentSummary,
  DownloadedAttachment,
  FieldMappings,
  OdooCredentials,
  OdooModelField,
  OdooWriteErrorType,
  PurchaseOrderSummary,
  SaleOrderLine,
  SalesOrderListItem,
  SaleOrderStockHandoff,
  SafeSaleOrderUpdateResult,
  SalesOrderDetails,
  SalesOrderSummary,
} from '../models/types';
import { env } from '../utils/env';
import { sanitizeBaseUrl } from '../utils/helpers';
import { isBoardProductName } from './boardProductClassifier';

interface OdooErrorResponse {
  name?: string;
  message?: string;
  arguments?: unknown[];
  context?: Record<string, unknown>;
}

interface OdooJsonRpcError {
  code?: number;
  message?: string;
  data?: {
    name?: string;
    message?: string;
    arguments?: unknown[];
  };
}

const MANUFACTURING_PERFORMANCE_START_DATE = '2026-08-05';

interface OdooJsonRpcResponse<T> {
  id?: number | string | null;
  jsonrpc?: string;
  result?: T;
  error?: OdooJsonRpcError;
}

interface SharedOdooWebSession {
  cookie: string;
  context: Record<string, unknown>;
  authenticated: boolean;
  awaitingOtp: boolean;
  csrfToken?: string;
  updatedAt: number;
}

const sharedOdooWebSessions = new Map<string, SharedOdooWebSession>();

function parseOdooDateTime(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeProductName(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isCuttingWorkOrderProductName(value: string | null | undefined): boolean {
  const normalized = normalizeProductName(value);
  return normalized.startsWith('cutting');
}

function isPhysicalInventoryMove(row: {
  reference?: string | null;
  origin?: string | null;
  inventory_id?: [number, string] | false | null;
  is_inventory?: boolean | null;
  location_id?: [number, string] | false | null;
  location_dest_id?: [number, string] | false | null;
}, locationId?: number | null): boolean {
  const reference = normalizeProductName(row.reference);
  const origin = normalizeProductName(row.origin);
  const inventoryMove = Boolean(row.inventory_id) || Boolean(row.is_inventory);
  const referencesPhysicalInventory =
    reference.includes('physical inventory') ||
    origin.includes('physical inventory') ||
    reference.includes('inventory adjustment') ||
    origin.includes('inventory adjustment');

  if (locationId && Array.isArray(row.location_dest_id) && row.location_dest_id[0] !== locationId) {
    return false;
  }

  return inventoryMove || referencesPhysicalInventory;
}

export class OdooClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'OdooClientError';
  }
}

export class OdooClient {
  private readonly timeoutMs = Number(env.REQUEST_TIMEOUT_MS || 20000);
  private readonly maxRateLimitRetries = Math.max(
    0,
    Number(env.ODOO_RATE_LIMIT_RETRIES || 3) || 3,
  );
  private readonly rateLimitRetryBaseMs = Math.max(
    250,
    Number(env.ODOO_RATE_LIMIT_RETRY_BASE_MS || 1500) || 1500,
  );
  private readonly saleOrderReadTimeoutMs = Number(
    env.SALE_ORDER_READ_TIMEOUT_MS || env.REQUEST_TIMEOUT_MS || 60000,
  );
  private readonly attachmentDownloadTimeoutMs = Number(
    env.ATTACHMENT_DOWNLOAD_TIMEOUT_MS || env.REQUEST_TIMEOUT_MS || 60000,
  );
  private readonly baseUrl: string;
  private readonly json2BaseUrl: string;
  private targetCompanyId: number | null = null;
  private webSessionCookie: string | null = null;
  private webSessionContext: Record<string, unknown> = {};
  private webRpcSequence = 0;

  constructor(private readonly credentials: OdooCredentials) {
    this.baseUrl = sanitizeBaseUrl(credentials.baseUrl);
    this.json2BaseUrl = `${this.baseUrl}/json/2`;
  }

  private get webSessionKey() {
    return [
      this.baseUrl.toLowerCase(),
      this.credentials.database.trim().toLowerCase(),
      this.credentials.username.trim().toLowerCase(),
    ].join('|');
  }

  async testConnection() {
    const versionResponse = await axios.get<{ version?: string; version_info?: unknown[] }>(
      `${this.baseUrl}/web/version`,
      {
        timeout: this.timeoutMs,
        validateStatus: () => true,
      },
    );

    if (versionResponse.status < 200 || versionResponse.status >= 300) {
      throw new OdooClientError(
        `Could not reach ${this.baseUrl}/web/version (${versionResponse.status}).`,
        versionResponse.status,
        versionResponse.data,
      );
    }

    const userList = await this.request<Array<{ id: number; name: string; login: string }>>(
      'res.users',
      'search_read',
      {
        domain: [['login', '=', this.credentials.username]],
        fields: ['id', 'name', 'login'],
        limit: 1,
      },
    );

    return {
      version:
        versionResponse.data?.version ||
        String(versionResponse.data?.version_info?.[0] || 'unknown'),
      user: userList[0] || null,
    };
  }

  async searchSalesOrders(searchTerm: string, limit = 25, offset = 0): Promise<SalesOrderSummary[]> {
    const trimmed = searchTerm.trim();
    const targetCompanyId = await this.getTargetCompanyId();
    const searchDomain = trimmed
      ? ['|', ['name', 'ilike', trimmed], ['client_order_ref', 'ilike', trimmed]]
      : [];
    const domain = targetCompanyId
      ? [['company_id', '=', targetCompanyId], ...searchDomain]
      : searchDomain;

    return this.request<SalesOrderSummary[]>('sale.order', 'search_read', {
      domain,
      fields: [
        'id',
        'name',
        'company_id',
        'partner_id',
        'date_order',
        'amount_total',
        'currency_id',
        'state',
        'user_id',
        'create_uid',
        'client_order_ref',
      ],
      limit,
      offset,
      order: 'date_order desc, id desc',
    });
  }

  async getConfirmedSalesOrdersSince(
    confirmedFromDate: string,
    limit = 50,
  ): Promise<SalesOrderSummary[]> {
    const targetCompanyId = await this.getTargetCompanyId();
    return this.request<SalesOrderSummary[]>('sale.order', 'search_read', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', 'in', ['sale', 'done']],
        ['date_order', '>=', confirmedFromDate],
      ],
      fields: [
        'id',
        'name',
        'company_id',
        'partner_id',
        'date_order',
        'amount_total',
        'currency_id',
        'state',
        'user_id',
        'create_uid',
        'client_order_ref',
      ],
      limit,
      order: 'date_order desc, id desc',
    });
  }

  async searchCustomerInvoicesSince(
    fromDate: string,
    limit = 500,
  ): Promise<CustomerInvoiceSummary[]> {
    const targetCompanyId = await this.getTargetCompanyId();
    const fromDay = fromDate.slice(0, 10);

    return this.request<CustomerInvoiceSummary[]>('account.move', 'search_read', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['move_type', 'in', ['out_invoice', 'out_receipt']],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', fromDay],
      ],
      fields: [
        'id',
        'name',
        'ref',
        'company_id',
        'partner_id',
        'invoice_date',
        'date',
        'amount_total',
        'amount_residual',
        'currency_id',
        'state',
        'move_type',
        'payment_state',
      ],
      limit,
      order: 'invoice_date desc, id desc',
    });
  }

  async searchInboundCustomerPaymentsSince(
    fromDate: string,
    limit = 500,
  ): Promise<CustomerPaymentSummary[]> {
    const targetCompanyId = await this.getTargetCompanyId();
    const fromDay = fromDate.slice(0, 10);
    const baseFields = [
      'id',
      'name',
      'company_id',
      'partner_id',
      'date',
      'amount',
      'currency_id',
      'state',
      'payment_type',
      'partner_type',
    ];
    const optionalFields = await this.getModelFields('account.payment', [
      'ref',
      'reconciled_invoice_ids',
      'paid_by',
    ])
      .then((fields) => fields.map((field) => field.name))
      .catch(() => []);

    return this.request<CustomerPaymentSummary[]>('account.payment', 'search_read', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['payment_type', '=', 'inbound'],
        ['partner_type', '=', 'customer'],
        ['state', 'in', ['posted', 'in_process', 'paid']],
        ['date', '>=', fromDay],
      ],
      fields: [...baseFields, ...optionalFields],
      limit,
      order: 'date desc, id desc',
    });
  }

  async searchPurchaseOrders(options: {
    searchTerm?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Array<PurchaseOrderSummary & { partner_ref?: string | null }>> {
    const trimmed = String(options.searchTerm || '').trim();
    const targetCompanyId = await this.getTargetCompanyId();
    const domain: unknown[] = [['company_id', '=', targetCompanyId]];

    if (options.fromDate) {
      domain.push(['date_order', '>=', options.fromDate]);
    }
    if (options.toDate) {
      domain.push(['date_order', '<=', options.toDate]);
    }
    if (trimmed) {
      domain.push(
        '|',
        '|',
        ['name', 'ilike', trimmed],
        ['partner_ref', 'ilike', trimmed],
        ['partner_id', 'ilike', trimmed],
      );
    }

    return this.request<Array<PurchaseOrderSummary & { partner_ref?: string | null }>>(
      'purchase.order',
      'search_read',
      {
        domain,
        fields: [
          'id',
          'name',
          'state',
          'date_order',
          'amount_total',
          'amount_untaxed',
          'partner_id',
          'currency_id',
          'invoice_status',
          'user_id',
          'picking_ids',
          'partner_ref',
        ],
        limit: options.limit || 25,
        offset: options.offset || 0,
        order: 'date_order desc, id desc',
      },
    );
  }

  async getSaleOrder(orderId: number): Promise<SalesOrderDetails> {
    const targetCompanyId = await this.getTargetCompanyId();
    const records = await this.request<SalesOrderDetails[]>(
      'sale.order',
      'read',
      {
        ids: [orderId],
        fields: [
          'id',
          'name',
          'company_id',
          'partner_id',
          'date_order',
          'amount_total',
          'currency_id',
          'state',
          'user_id',
          'create_uid',
          'client_order_ref',
          'note',
          'validity_date',
        ],
      },
      {
        timeoutMs: this.saleOrderReadTimeoutMs,
      },
    );

    const order = records[0];

    if (!order) {
      throw new OdooClientError(`Sales Order ${orderId} was not found.`);
    }

    const orderCompanyId = Array.isArray(order.company_id) ? order.company_id[0] : null;

    if (orderCompanyId !== targetCompanyId) {
      throw new OdooClientError(
        `Sales Order ${orderId} does not belong to ${env.ODOO_TARGET_COMPANY_NAME}.`,
      );
    }

    return order;
  }

  async getAttachments(orderId: number): Promise<AttachmentInfo[]> {
    const attachmentFields = ['id', 'name', 'mimetype', 'create_date', 'write_date', 'file_size'];
    const directAttachments = await this.request<AttachmentInfo[]>('ir.attachment', 'search_read', {
      domain: [
        ['res_model', '=', 'sale.order'],
        ['res_id', '=', orderId],
      ],
      fields: attachmentFields,
      limit: 200,
      order: 'write_date desc, create_date desc, id desc',
    });

    let chatterAttachments: AttachmentInfo[] = [];

    try {
      const messages = await this.request<Array<{ id: number }>>('mail.message', 'search_read', {
        domain: [
          ['model', '=', 'sale.order'],
          ['res_id', '=', orderId],
        ],
        fields: ['id'],
        limit: 500,
        order: 'id desc',
      });
      const messageIds = messages.map((message) => message.id).filter(Boolean);

      if (messageIds.length > 0) {
        chatterAttachments = await this.request<AttachmentInfo[]>('ir.attachment', 'search_read', {
          domain: [
            ['res_model', '=', 'mail.message'],
            ['res_id', 'in', messageIds],
          ],
          fields: attachmentFields,
          limit: 200,
          order: 'write_date desc, create_date desc, id desc',
        });
      }
    } catch (error) {
      console.warn(
        '[odoo] Could not load chatter attachments for sale.order.',
        error instanceof Error ? error.message : error,
      );
    }

    const byId = new Map<number, AttachmentInfo>();
    [...directAttachments, ...chatterAttachments].forEach((attachment) => {
      byId.set(attachment.id, attachment);
    });

    return [...byId.values()].sort((left, right) => {
      const leftDate = new Date(left.write_date || left.create_date || 0).getTime();
      const rightDate = new Date(right.write_date || right.create_date || 0).getTime();

      if (leftDate !== rightDate) {
        return rightDate - leftDate;
      }

      return right.id - left.id;
    });
  }

  async getAttachmentsForSaleOrders(orderIds: number[]): Promise<Map<number, AttachmentInfo[]>> {
    const result = new Map<number, AttachmentInfo[]>();
    const ids = [...new Set(orderIds.filter((id) => Number.isInteger(id) && id > 0))];
    ids.forEach((id) => result.set(id, []));
    if (ids.length === 0) {
      return result;
    }

    const attachmentFields = ['id', 'name', 'mimetype', 'create_date', 'write_date', 'file_size', 'res_model', 'res_id'];
    const directAttachments = await this.request<Array<AttachmentInfo & { res_model?: string; res_id?: number }>>(
      'ir.attachment',
      'search_read',
      {
        domain: [
          ['res_model', '=', 'sale.order'],
          ['res_id', 'in', ids],
        ],
        fields: attachmentFields,
        limit: Math.max(200, ids.length * 200),
        order: 'write_date desc, create_date desc, id desc',
      },
    );

    directAttachments.forEach((attachment) => {
      if (attachment.res_id && result.has(attachment.res_id)) {
        result.get(attachment.res_id)!.push(attachment);
      }
    });

    try {
      const messages = await this.request<Array<{ id: number; res_id?: number }>>('mail.message', 'search_read', {
        domain: [
          ['model', '=', 'sale.order'],
          ['res_id', 'in', ids],
        ],
        fields: ['id', 'res_id'],
        limit: Math.max(500, ids.length * 500),
        order: 'id desc',
      });
      const messageToOrder = new Map(messages.filter((message) => message.res_id).map((message) => [message.id, message.res_id!]));
      const messageIds = [...messageToOrder.keys()];
      if (messageIds.length > 0) {
        const chatterAttachments = await this.request<Array<AttachmentInfo & { res_id?: number }>>('ir.attachment', 'search_read', {
          domain: [
            ['res_model', '=', 'mail.message'],
            ['res_id', 'in', messageIds],
          ],
          fields: attachmentFields,
          limit: Math.max(200, ids.length * 200),
          order: 'write_date desc, create_date desc, id desc',
        });
        chatterAttachments.forEach((attachment) => {
          const orderId = attachment.res_id ? messageToOrder.get(attachment.res_id) : undefined;
          if (orderId && result.has(orderId)) {
            result.get(orderId)!.push(attachment);
          }
        });
      }
    } catch (error) {
      console.warn('[odoo] Could not load sale.order chatter attachments in bulk.', error instanceof Error ? error.message : error);
    }

    result.forEach((attachments, orderId) => {
      const byId = new Map<number, AttachmentInfo>();
      attachments.forEach((attachment) => byId.set(attachment.id, attachment));
      result.set(orderId, [...byId.values()].sort((left, right) => {
        const leftDate = new Date(left.write_date || left.create_date || 0).getTime();
        const rightDate = new Date(right.write_date || right.create_date || 0).getTime();
        return rightDate !== leftDate ? rightDate - leftDate : right.id - left.id;
      }));
    });

    return result;
  }

  async getAttachmentRecord(attachmentId: number): Promise<{
    id: number;
    name: string;
    res_model: string;
    res_id: number;
    mimetype: string;
  } | null> {
    const records = await this.request<Array<{
      id: number;
      name: string;
      res_model: string;
      res_id: number;
      mimetype: string;
    }>>('ir.attachment', 'search_read', {
      domain: [['id', '=', attachmentId]],
      fields: ['id', 'name', 'res_model', 'res_id', 'mimetype'],
      limit: 1,
    });
    return records[0] || null;
  }

  async getMailMessageTarget(messageId: number): Promise<{
    id: number;
    model: string;
    res_id: number;
    record_name?: string | null;
  } | null> {
    const records = await this.request<
      Array<{
        id: number;
        model?: string | null;
        res_id?: number | null;
        record_name?: string | null;
      }>
    >('mail.message', 'read', {
      ids: [messageId],
      fields: ['id', 'model', 'res_id', 'record_name'],
    });

    const record = records[0];
    if (!record || !record.model || !record.res_id) {
      return null;
    }

    return {
      id: record.id,
      model: record.model,
      res_id: record.res_id,
      record_name: record.record_name || null,
    };
  }

  async downloadAttachment(attachmentId: number): Promise<DownloadedAttachment> {
    const records = await this.request<
      Array<{
        id: number;
        name: string;
        mimetype?: string | null;
        file_size?: number | null;
        datas?: string | null;
      }>
    >(
      'ir.attachment',
      'read',
      {
        ids: [attachmentId],
        fields: ['name', 'mimetype', 'file_size', 'datas'],
      },
      {
        timeoutMs: this.attachmentDownloadTimeoutMs,
      },
    );

    const attachment = records[0];

    if (!attachment) {
      throw new OdooClientError(`Attachment ${attachmentId} was not found.`);
    }

    if (!attachment.datas) {
      throw new OdooClientError(
        `Attachment ${attachment.name} did not return binary data. Confirm the Odoo user has access to ir.attachment datas.`,
      );
    }

    return {
      id: attachment.id,
      name: attachment.name,
      mimetype: attachment.mimetype || null,
      fileSize: attachment.file_size || null,
      content: Buffer.from(attachment.datas, 'base64'),
    };
  }

  async updateSaleOrder(orderId: number, data: Record<string, unknown>) {
    return this.request<boolean>('sale.order', 'write', {
      ids: [orderId],
      vals: data,
    });
  }

  async getSaleOrderFields(): Promise<OdooModelField[]> {
    const response = await this.request<
      Record<
        string,
        {
          string?: string;
          type?: string;
        }
      >
    >('sale.order', 'fields_get', {
      attributes: ['string', 'type'],
    });

    return Object.entries(response)
      .map(([name, field]) => ({
        name,
        label: field.string || name,
        type: field.type || 'unknown',
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.name.localeCompare(right.name));
  }

  async readSaleOrderFields(
    orderId: number,
    fieldNames: string[],
  ): Promise<Record<string, unknown>> {
    const uniqueFieldNames = [...new Set(fieldNames.map((fieldName) => fieldName.trim()).filter(Boolean))];

    if (uniqueFieldNames.length === 0) {
      return {};
    }

    const records = await this.request<Array<Record<string, unknown>>>(
      'sale.order',
      'read',
      {
        ids: [orderId],
        fields: uniqueFieldNames,
      },
      {
        timeoutMs: this.saleOrderReadTimeoutMs,
      },
    );

    return records[0] || {};
  }

  async getSaleOrderStockHandoff(
    orderId: number,
    mappings: FieldMappings,
  ): Promise<SaleOrderStockHandoff> {
    const order = await this.getSaleOrder(orderId);
    const fieldNames = [
      mappings.edgeJsonField,
      mappings.previousJsonField,
      mappings.signatureField,
      mappings.stockSignatureField,
      mappings.stockProcessedField,
      mappings.deltaJsonField,
      mappings.logField,
    ].filter(Boolean);
    const values = await this.readSaleOrderFields(orderId, fieldNames);

    return {
      orderId: order.id,
      orderName: order.name,
      edgeJson: String(values[mappings.edgeJsonField] || ''),
      previousJson: String(values[mappings.previousJsonField] || ''),
      signature: String(values[mappings.signatureField] || ''),
      stockSignature: String(values[mappings.stockSignatureField] || ''),
      stockProcessed: Boolean(values[mappings.stockProcessedField]),
      stockAdjustmentInputJson: String(values[mappings.deltaJsonField] || ''),
      processingLog: String(values[mappings.logField] || ''),
    };
  }

  async getSaleOrderStockHandoffs(orderIds: number[], mappings: FieldMappings): Promise<Map<number, SaleOrderStockHandoff>> {
    const result = new Map<number, SaleOrderStockHandoff>();
    const ids = [...new Set(orderIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) {
      return result;
    }
    const targetCompanyId = await this.getTargetCompanyId();
    const fieldNames = [
      'id', 'name', 'company_id', mappings.edgeJsonField, mappings.previousJsonField,
      mappings.signatureField, mappings.stockSignatureField, mappings.stockProcessedField,
      mappings.deltaJsonField, mappings.logField,
    ].filter(Boolean);
    const orders = await this.request<Array<Record<string, unknown>>>('sale.order', 'read', {
      ids,
      fields: [...new Set(fieldNames)],
    }, { timeoutMs: this.saleOrderReadTimeoutMs });
    orders.forEach((order) => {
      const orderId = Number(order.id);
      const companyId = Array.isArray(order.company_id) ? order.company_id[0] : null;
      if (!orderId || companyId !== targetCompanyId) {
        return;
      }
      result.set(orderId, {
        orderId,
        orderName: String(order.name || ''),
        edgeJson: String(order[mappings.edgeJsonField] || ''),
        previousJson: String(order[mappings.previousJsonField] || ''),
        signature: String(order[mappings.signatureField] || ''),
        stockSignature: String(order[mappings.stockSignatureField] || ''),
        stockProcessed: Boolean(order[mappings.stockProcessedField]),
        stockAdjustmentInputJson: String(order[mappings.deltaJsonField] || ''),
        processingLog: String(order[mappings.logField] || ''),
      });
    });
    return result;
  }

  async getSaleOrderLines(orderId: number): Promise<SaleOrderLine[]> {
    return this.request<SaleOrderLine[]>('sale.order.line', 'search_read', {
      domain: [['order_id', '=', orderId]],
      fields: ['id', 'name', 'product_id', 'product_uom_qty', 'price_subtotal', 'price_total', 'display_type'],
      limit: 500,
      order: 'id asc',
    });
  }

  async getManufacturingOrdersBySaleLineId(saleLineId: number): Promise<
    Array<{
      id: number;
      name: string;
      state: string;
      date_start?: string | null;
      date_finished?: string | null;
      write_date?: string | null;
      create_date?: string | null;
    }>
  > {
    return this.request<
      Array<{
        id: number;
        name: string;
        state: string;
        date_start?: string | null;
        date_finished?: string | null;
        write_date?: string | null;
        create_date?: string | null;
      }>
    >('mrp.production', 'search_read', {
      domain: [['sale_line_id', '=', saleLineId]],
      fields: ['id', 'name', 'state', 'date_start', 'date_finished', 'write_date', 'create_date'],
      limit: 50,
      order: 'id desc',
    });
  }

  async getProductVariant(productId: number): Promise<{
    id: number;
    name: string;
    display_name: string;
    product_tmpl_id?: [number, string] | false | null;
  } | null> {
    const products = await this.request<
      Array<{
        id: number;
        name: string;
        display_name: string;
        product_tmpl_id?: [number, string] | false | null;
      }>
    >('product.product', 'read', {
      ids: [productId],
      fields: ['id', 'name', 'display_name', 'product_tmpl_id'],
    });

    return products[0] || null;
  }

  async getProductVariantsByTemplate(templateId: number): Promise<
    Array<{
      id: number;
      name: string;
      display_name: string;
      product_tmpl_id?: [number, string] | false | null;
    }>
  > {
    return this.request<
      Array<{
        id: number;
        name: string;
        display_name: string;
        product_tmpl_id?: [number, string] | false | null;
      }>
    >('product.product', 'search_read', {
      domain: [['product_tmpl_id', '=', templateId]],
      fields: ['id', 'name', 'display_name', 'product_tmpl_id'],
      limit: 200,
      order: 'id asc',
    });
  }

  async getBomCandidatesForProduct(productId: number, templateId: number): Promise<
    Array<{
      id: number;
      product_id?: [number, string] | false | null;
      product_tmpl_id?: [number, string] | false | null;
      company_id?: [number, string] | false | null;
      active?: boolean;
    }>
  > {
    const targetCompanyId = await this.getTargetCompanyId();
    return this.request<
      Array<{
        id: number;
        product_id?: [number, string] | false | null;
        product_tmpl_id?: [number, string] | false | null;
        company_id?: [number, string] | false | null;
        active?: boolean;
      }>
    >('mrp.bom', 'search_read', {
      domain: [
        ['active', '=', true],
        '|',
        ['company_id', '=', false],
        ['company_id', '=', targetCompanyId],
        '|',
        ['product_id', '=', productId],
        ['product_tmpl_id', '=', templateId],
      ],
      fields: ['id', 'product_id', 'product_tmpl_id', 'company_id', 'active'],
      limit: 50,
      order: 'sequence asc, id asc',
    });
  }

  async getBomLines(bomId: number): Promise<
    Array<{
      id: number;
      product_id?: [number, string] | false | null;
      product_tmpl_id?: [number, string] | false | null;
      product_qty?: number | null;
    }>
  > {
    return this.request<
      Array<{
        id: number;
        product_id?: [number, string] | false | null;
        product_tmpl_id?: [number, string] | false | null;
        product_qty?: number | null;
      }>
    >('mrp.bom.line', 'search_read', {
      domain: [['bom_id', '=', bomId]],
      fields: ['id', 'product_id', 'product_tmpl_id', 'product_qty'],
      limit: 500,
      order: 'id asc',
    });
  }

  async getStockLocationById(locationId: number): Promise<{ id: number; complete_name?: string; name: string } | null> {
    const locations = await this.request<
      Array<{ id: number; complete_name?: string; name: string }>
    >('stock.location', 'read', {
      ids: [locationId],
      fields: ['id', 'name', 'complete_name'],
    });

    return locations[0] || null;
  }

  async findStockLocationsByName(name: string): Promise<
    Array<{ id: number; complete_name?: string; name: string }>
  > {
    return this.request<Array<{ id: number; complete_name?: string; name: string }>>(
      'stock.location',
      'search_read',
      {
        domain: ['|', ['name', '=', name], ['complete_name', '=', name]],
        fields: ['id', 'name', 'complete_name'],
        limit: 25,
        order: 'id asc',
      },
    );
  }

  async getStockQuants(productId: number, locationId: number): Promise<Array<{ id: number; quantity: number | null }>> {
    return this.request<Array<{ id: number; quantity: number | null }>>('stock.quant', 'search_read', {
      domain: [
        ['product_id', '=', productId],
        ['location_id', '=', locationId],
      ],
      fields: ['id', 'quantity'],
      limit: 25,
      order: 'id asc',
    });
  }

  async adjustStockAtLocation(
    productId: number,
    locationId: number,
    targetQuantity: number,
  ): Promise<void> {
    const quants = await this.getStockQuants(productId, locationId);

    if (quants.length > 1) {
      throw new OdooClientError(
        `Multiple stock quants were found for product ${productId} at location ${locationId}.`,
      );
    }

    let quantId = quants[0]?.id;

    if (!quantId) {
      quantId = await this.createRecord('stock.quant', {
        product_id: productId,
        location_id: locationId,
        inventory_quantity: targetQuantity,
      });
    } else {
      await this.writeRecord('stock.quant', [quantId], {
        inventory_quantity: targetQuantity,
      });
    }

    await this.callRecordMethod('stock.quant', 'action_apply_inventory', [quantId]);
  }

  async safeUpdateSaleOrder(
    orderId: number,
    payload: Record<string, unknown>,
    availableFields?: OdooModelField[],
  ): Promise<SafeSaleOrderUpdateResult> {
    const resolvedFields = availableFields || (await this.getSaleOrderFields());
    const validFieldNames = new Set(resolvedFields.map((field) => field.name));
    const filteredPayload: Record<string, unknown> = {};
    const skippedFields: SafeSaleOrderUpdateResult['skippedFields'] = [];

    Object.entries(payload).forEach(([fieldName, value]) => {
      if (!validFieldNames.has(fieldName)) {
        skippedFields.push({
          name: fieldName,
          reason: 'Field does not exist in Odoo or is not accessible.',
        });
        return;
      }

      filteredPayload[fieldName] = value;
    });

    const sentFields = Object.keys(filteredPayload);
    const warnings =
      skippedFields.length > 0
        ? ['Some fields were skipped because they do not exist in Odoo.']
        : [];

    if (sentFields.length === 0) {
      return {
        success: true,
        message:
          skippedFields.length > 0
            ? 'Some fields were skipped because they do not exist in Odoo.'
            : 'No valid sale.order fields were available to update.',
        sentFields,
        skippedFields,
        warnings,
      };
    }

    try {
      await this.updateSaleOrder(orderId, filteredPayload);

      return {
        success: true,
        message:
          skippedFields.length > 0
            ? 'Sale Order updated. Some fields were skipped because they do not exist in Odoo.'
            : 'Sale Order updated successfully.',
        sentFields,
        skippedFields,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Odoo update failed.';

      return {
        success: false,
        message,
        sentFields: [],
        skippedFields,
        warnings,
        errorType: this.classifyWriteError(error),
      };
    }
  }

  async postChatterMessage(orderId: number, message: string) {
    return this.request<number>('sale.order', 'message_post', {
      ids: [orderId],
      body: message,
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_note',
    });
  }

  async postChatterAlert(orderId: number, message: string, partnerIds: number[] = []) {
    return this.request<number>('sale.order', 'message_post', {
      ids: [orderId],
      body: message,
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_comment',
      partner_ids: partnerIds,
    });
  }

  async findUserByLoginOrEmail(loginOrEmail: string): Promise<{
    id: number;
    name: string;
    login: string;
    partnerId: number | null;
    partnerName: string;
  } | null> {
    const value = loginOrEmail.trim();
    if (!value) {
      return null;
    }

    const users = await this.request<
      Array<{
        id: number;
        name: string;
        login: string;
        partner_id?: [number, string] | false | null;
      }>
    >('res.users', 'search_read', {
      domain: ['|', ['login', '=', value], ['email', '=', value]],
      fields: ['id', 'name', 'login', 'partner_id'],
      limit: 2,
    });

    if (users.length !== 1) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      name: user.name,
      login: user.login,
      partnerId: Array.isArray(user.partner_id) ? user.partner_id[0] : null,
      partnerName: Array.isArray(user.partner_id) ? user.partner_id[1] : '',
    };
  }

  async findUserByNameLoginOrEmail(value: string): Promise<{
    id: number;
    name: string;
    login: string;
    partnerId: number | null;
    partnerName: string;
  } | null> {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const users = await this.request<
      Array<{
        id: number;
        name: string;
        login: string;
        partner_id?: [number, string] | false | null;
      }>
    >('res.users', 'search_read', {
      domain: ['|', '|', ['login', '=', trimmed], ['email', '=', trimmed], ['name', '=', trimmed]],
      fields: ['id', 'name', 'login', 'partner_id'],
      limit: 2,
    });

    if (users.length !== 1) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      name: user.name,
      login: user.login,
      partnerId: Array.isArray(user.partner_id) ? user.partner_id[0] : null,
      partnerName: Array.isArray(user.partner_id) ? user.partner_id[1] : '',
    };
  }

  async getModelFields(modelName: string, fieldNames: string[]) {
    if (fieldNames.length === 0) {
      return [];
    }

    return this.request<Array<{ name: string; field_description?: string }>>(
      'ir.model.fields',
      'search_read',
      {
        domain: [
          ['model', '=', modelName],
          ['name', 'in', fieldNames],
        ],
        fields: ['name', 'field_description'],
        limit: fieldNames.length,
      },
    );
  }

  async createRecord(
    model: string,
    values: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): Promise<number> {
    const result = await this.request<unknown>(model, 'create', {
      vals_list: [values],
      ...(Object.keys(context).length > 0 ? { context } : {}),
    });
    const rawId = Array.isArray(result)
      ? result[0]
      : result && typeof result === 'object' && 'id' in result
        ? (result as { id: unknown }).id
        : result;
    const recordId = Number(rawId);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      throw new OdooClientError(`Odoo did not return a valid ID after creating ${model}.`);
    }
    return recordId;
  }

  async writeRecord(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean> {
    return this.request<boolean>(model, 'write', {
      ids,
      vals: values,
    });
  }

  async setManufacturingOrderPlanDate(moId: number, planDate: string): Promise<boolean> {
    return this.writeRecord('mrp.production', [moId], {
      date_deadline: planDate,
    });
  }

  async searchReadRecords<T>(
    model: string,
    options: {
      domain?: unknown[];
      fields?: string[];
      limit?: number;
      offset?: number;
      order?: string;
      context?: Record<string, unknown>;
    },
  ): Promise<T[]> {
    return this.request<T[]>(model, 'search_read', {
      domain: options.domain || [],
      fields: options.fields || [],
      limit: options.limit,
      offset: options.offset,
      order: options.order,
      context: options.context,
    });
  }

  async searchCountRecords(model: string, domain: unknown[] = []): Promise<number> {
    return this.request<number>(model, 'search_count', {
      domain,
    });
  }

  async readRecords<T>(model: string, ids: number[], fields: string[]): Promise<T[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.request<T[]>(model, 'read', {
      ids,
      fields,
    });
  }

  async postModelChatterMessage(model: string, recordId: number, message: string) {
    return this.request<number>(model, 'message_post', {
      ids: [recordId],
      body: message,
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_note',
    });
  }

  async callRecordMethod<T>(
    model: string,
    method: string,
    ids: number[],
    values: Record<string, unknown> = {},
  ): Promise<T> {
    return this.request<T>(model, method, { ids, ...values });
  }

  async checkModelAccess(model: string, operation: 'read' | 'write' | 'create' | 'unlink'): Promise<boolean> {
    return this.request<boolean>(model, 'check_access_rights', {
      operation,
      raise_exception: false,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async getTargetCompanyIdValue(): Promise<number> {
    return this.getTargetCompanyId();
  }

  private async getTargetCompanyId(): Promise<number> {
    if (this.targetCompanyId) {
      return this.targetCompanyId;
    }

    const companies = await this.request<Array<{ id: number; name: string }>>(
      'res.company',
      'search_read',
      {
        domain: [['name', '=', env.ODOO_TARGET_COMPANY_NAME]],
        fields: ['id', 'name'],
        limit: 1,
      },
    );

    const company = companies[0];

    if (!company) {
      throw new OdooClientError(
        `Target company "${env.ODOO_TARGET_COMPANY_NAME}" was not found in Odoo.`,
      );
    }

    this.targetCompanyId = company.id;
    return this.targetCompanyId;
  }

  // ─── Shop Floor / Operator Methods ──────────────────────────────────

  /**
   * Find hr.employee by work email directly (for operators without res.users accounts).
   */
  async findEmployeeByWorkEmail(email: string) {
    const employees = await this.request<Array<{
      id: number;
      name: string;
      job_title: string | null;
      department_id: [number, string] | null;
      work_email: string | null;
      mobile_phone: string | null;
      parent_id: [number, string] | null;
    }>>(
      'hr.employee',
      'search_read',
      {
        domain: [['work_email', '=ilike', email]],
        fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'mobile_phone', 'parent_id'],
        limit: 1,
      },
    );

    return employees[0] || null;
  }

  /**
   * Find hr.employee record linked to the current user's res.partner.
   */
  async findEmployeeByUserEmail(email: string) {
    const user = await this.findUserByLoginOrEmail(email);
    if (!user) return null;

    const employees = await this.request<Array<{
      id: number;
      name: string;
      job_title: string | null;
      department_id: [number, string] | null;
      work_email: string | null;
      mobile_phone: string | null;
      parent_id: [number, string] | null;
    }>>(
      'hr.employee',
      'search_read',
      {
        domain: [['user_id', '=', user.id]],
        fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'mobile_phone', 'parent_id'],
        limit: 1,
      },
    );

    return employees[0] || null;
  }

  /**
   * Resolve an authenticated app user to an Odoo employee in one request.
   * This is used by latency-sensitive Shop Floor actions and does not use an
   * employee PIN because the app session has already authenticated the user.
   */
  async findEmployeeForShopFloorEmail(email: string) {
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) return null;
    const employees = await this.request<Array<{
      id: number;
      name: string;
      job_title: string | null;
      department_id: [number, string] | null;
      work_email: string | null;
      mobile_phone: string | null;
      parent_id: [number, string] | null;
    }>>(
      'hr.employee',
      'search_read',
      {
        domain: [
          '|',
          ['work_email', '=ilike', normalizedEmail],
          ['user_id.login', '=ilike', normalizedEmail],
        ],
        fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'mobile_phone', 'parent_id'],
        limit: 1,
      },
    );
    return employees[0] || null;
  }

  /**
   * Search hr.department by name (e.g. "Operations", "Production").
   */
  async findDepartmentByName(name: string) {
    const departments = await this.request<Array<{ id: number; name: string }>>(
      'hr.department',
      'search_read',
      {
        domain: [['name', 'ilike', name]],
        fields: ['id', 'name'],
        limit: 5,
      },
    );
    return departments;
  }

  /**
   * Get all employees in a department.
   */
  async getEmployeesByDepartment(departmentId: number, companyId?: number) {
    return this.request<Array<{
      id: number;
      name: string;
      job_title: string | null;
      department_id: [number, string] | null;
      work_email: string | null;
      mobile_phone: string | null;
      user_id: [number, string] | null;
      parent_id: [number, string] | null;
    }>>(
      'hr.employee',
      'search_read',
      {
        domain: [
          ['department_id', '=', departmentId],
          ...(companyId ? [['company_id', '=', companyId]] : []),
        ],
        fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'mobile_phone', 'user_id', 'parent_id'],
        limit: 200,
      },
    );
  }

  /**
   * Get attendance summary for multiple employees on a given date.
   */
  async getBulkAttendance(employeeIds: number[], dateStr?: string) {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);

    const records = await this.request<Array<{
      id: number;
      employee_id: [number, string];
      check_in: string;
      check_out: string | null;
      worked_hours: number;
    }>>(
      'hr.attendance',
      'search_read',
      {
        domain: [
          ['employee_id', 'in', employeeIds],
          ['check_in', '>=', `${targetDate} 00:00:00`],
          ['check_in', '<=', `${targetDate} 23:59:59`],
        ],
        fields: ['id', 'employee_id', 'check_in', 'check_out', 'worked_hours'],
        limit: employeeIds.length * 5,
      },
    );

    return records;
  }

  /**
   * Get today's attendance status for an employee.
   */
  async getTodayAttendance(employeeId: number) {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const records = await this.request<Array<{
      id: number;
      check_in: string;
      check_out: string | null;
      worked_hours: number;
    }>>(
      'hr.attendance',
      'search_read',
      {
        domain: [
          ['employee_id', '=', employeeId],
          ['check_in', '>=', `${todayStr} 00:00:00`],
          ['check_in', '<=', `${todayStr} 23:59:59`],
        ],
        fields: ['id', 'check_in', 'check_out', 'worked_hours'],
        order: 'check_in desc',
      },
    );

    // Also check Odoo's check_in/check_out directly
    const checkIns = await this.request<Array<{
      id: number;
      check_in: string;
      check_out: string | null;
    }>>(
      'hr.attendance',
      'search_read',
      {
        domain: [
          ['employee_id', '=', employeeId],
        ],
        fields: ['id', 'check_in', 'check_out'],
        order: 'check_in desc',
        limit: 5,
      },
    );

    const todayRecord = checkIns.find((r) => r.check_in?.startsWith(todayStr));

    return {
      checkedIn: Boolean(todayRecord?.check_in && !todayRecord.check_out),
      checkedOut: Boolean(todayRecord?.check_out),
      todayRecord: todayRecord || null,
      recentRecords: checkIns.slice(0, 5),
    };
  }

  /**
   * Count late check-ins this month (after 8:30 AM EAT).
   */
  async getLateCountThisMonth(employeeId: number): Promise<number> {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const records = await this.request<Array<{ check_in: string }>>(
      'hr.attendance',
      'search_read',
      {
        domain: [
          ['employee_id', '=', employeeId],
          ['check_in', '>=', `${monthStart} 00:00:00`],
        ],
        fields: ['check_in'],
        limit: 100,
      },
    );

    let lateCount = 0;
    for (const r of records) {
      if (!r.check_in) continue;
      const d = new Date(r.check_in.replace(' ', 'T'));
      if (d.getHours() > 8 || (d.getHours() === 8 && d.getMinutes() > 30)) {
        lateCount++;
      }
    }
    return lateCount;
  }

  /**
   * Get manufacturing orders assigned to an employee (by user_id).
   */
  async getOperatorWorkOrders(userId: number, limit = 50) {
    return this.request<Array<{
      id: number;
      name: string;
      product_id: [number, string];
      product_qty: number;
      qty_produced: number;
      state: string;
      date_start: string | null;
      date_finished: string | null;
      user_id: [number, string] | null;
      origin: string | null;
      create_date: string | null;
      partner_id: [number, string] | null;
    }>>(
      'mrp.production',
      'search_read',
      {
        domain: [['user_id', '=', userId]],
        fields: [
          'id', 'name', 'product_id', 'product_qty', 'qty_produced',
          'state', 'date_start', 'date_finished',
          'user_id', 'origin', 'partner_id',
        ],
        order: 'date_start desc',
        limit,
      },
    );
  }

  /**
   * Get ALL active manufacturing orders (not filtered by user).
   * For shop floor visibility — operators see all orders, categorized by area.
   */
  async getAllActiveWorkOrders(limit = 100) {
    return this.request<Array<{
      id: number;
      name: string;
      product_id: [number, string];
      product_qty: number;
      qty_produced: number;
      state: string;
      date_start: string | null;
      date_finished: string | null;
      date_deadline: string | null;
      user_id: [number, string] | null;
      origin: string | null;
      create_date: string | null;
    }>>(
      'mrp.production',
      'search_read',
      {
        // `to_close` means all shop-floor operations are complete and the MO is
        // awaiting production closure in Odoo. It must not be offered to an
        // operator as a new Start action.
        domain: [['state', 'not in', ['done', 'cancel', 'draft', 'to_close']]],
        fields: [
          'id', 'name', 'product_id', 'product_qty', 'qty_produced',
          'state', 'date_start', 'date_finished', 'date_deadline',
          'user_id', 'origin', 'create_date',
        ],
        order: 'date_start desc',
        limit,
      },
    );
  }

  async getManufacturingPerformanceOrders(fromDate = MANUFACTURING_PERFORMANCE_START_DATE) {
    const toDate = new Date().toISOString().slice(0, 10);
    return this.request<Array<{
      id: number;
      name: string;
      product_id: [number, string];
      product_qty: number;
      state: string;
      date_start: string | null;
      date_finished: string | null;
      origin: string | null;
      create_date: string | null;
    }>>('mrp.production', 'search_read', {
      domain: [
        ['state', '=', 'done'],
        ['date_finished', '>=', `${fromDate} 00:00:00`],
        ['date_finished', '<=', `${toDate} 23:59:59`],
      ],
      fields: ['id', 'name', 'product_id', 'product_qty', 'state', 'date_start', 'date_finished', 'origin', 'create_date'],
      order: 'date_finished desc, id desc',
      limit: 5000,
    });
  }

  async getBulkWorkOrderStates(moIds: number[]) {
    if (!moIds.length) return new Map<number, 'progress' | 'pending' | 'ready'>();
    const workorders = await this.searchReadRecords<{
      id: number;
      production_id: [number, string] | false;
      state: string;
    }>('mrp.workorder', {
      domain: [['production_id', 'in', moIds], ['state', 'not in', ['done', 'cancel']]],
      fields: ['id', 'production_id', 'state'],
      limit: 500,
    });

    const stateMap = new Map<number, 'progress' | 'pending' | 'ready'>();
    for (const wo of workorders) {
      if (wo.production_id) {
        const moId = wo.production_id[0];
        const existing = stateMap.get(moId);
        if (wo.state === 'progress') {
          stateMap.set(moId, 'progress');
        } else if (wo.state === 'pending') {
          if (existing !== 'progress') {
            stateMap.set(moId, 'pending');
          }
        } else if (!existing && (wo.state === 'ready' || wo.state === 'progress' || wo.state === 'pending')) {
          stateMap.set(moId, wo.state as 'progress' | 'pending' | 'ready');
        }
      }
    }
    return stateMap;
  }

  async getWarehouseScopedActiveWorkOrders(warehouseId: number, limit = 500) {
    const targetCompanyId = await this.getTargetCompanyId();
    const warehouses = await this.searchReadRecords<{ id: number; name: string; code: string; company_id: [number, string] | false }>('stock.warehouse', {
      domain: [['id', '=', warehouseId], ['company_id', '=', targetCompanyId]],
      fields: ['id', 'name', 'code', 'company_id'],
      limit: 1,
    });
    if (!warehouses.length) {
      throw new OdooClientError(`Configured warehouse ${warehouseId} does not belong to ${env.ODOO_TARGET_COMPANY_NAME}.`);
    }
    const orders = await this.request<Array<{
      id: number; name: string; product_id: [number, string]; product_qty: number; qty_produced: number;
      state: string; date_start: string | null; date_finished: string | null; date_deadline: string | null;
      user_id: [number, string] | null; origin: string | null; create_date: string | null;
    }>>('mrp.production', 'search_read', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['picking_type_id.warehouse_id', '=', warehouseId],
        ['state', 'not in', ['done', 'cancel', 'draft', 'to_close']],
      ],
      fields: ['id', 'name', 'product_id', 'product_qty', 'qty_produced', 'state', 'date_start', 'date_finished', 'date_deadline', 'user_id', 'origin', 'create_date'],
      order: 'date_start desc',
      limit,
    });
    const warehouseCode = String(warehouses[0].code || '').trim().toUpperCase();
    if (!warehouseCode) {
      throw new OdooClientError(`Configured warehouse ${warehouseId} has no Odoo warehouse code.`);
    }
    const expectedPrefix = `${warehouseCode}/MO/`;
    return orders.filter((order) => String(order.name || '').toUpperCase().startsWith(expectedPrefix));
  }

  async getWarehouseManufacturingOrderCompletionSummary(
    warehouseId: number,
    fromDate: string,
    toDate: string,
  ) {
    const targetCompanyId = await this.getTargetCompanyId();
    const warehouses = await this.searchReadRecords<{ id: number; name: string; code: string; company_id: [number, string] | false }>('stock.warehouse', {
      domain: [['id', '=', warehouseId], ['company_id', '=', targetCompanyId]],
      fields: ['id', 'name', 'code', 'company_id'],
      limit: 1,
    });
    if (!warehouses.length) {
      throw new OdooClientError(`Configured warehouse ${warehouseId} does not belong to ${env.ODOO_TARGET_COMPANY_NAME}.`);
    }

    const orders = await this.request<Array<{
      id: number;
      name: string;
      state: string;
      create_date: string | null;
      date_finished: string | null;
    }>>('mrp.production', 'search_read', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['picking_type_id.warehouse_id', '=', warehouseId],
        ['create_date', '>=', `${fromDate} 00:00:00`],
        ['create_date', '<=', `${toDate} 23:59:59`],
      ],
      fields: ['id', 'name', 'state', 'create_date', 'date_finished'],
      order: 'create_date asc, id asc',
      limit: 5000,
    });

    const warehouseCode = String(warehouses[0].code || '').trim().toUpperCase();
    const expectedPrefix = `${warehouseCode}/MO/`;
    const warehouseOrders = orders.filter((order) => String(order.name || '').toUpperCase().startsWith(expectedPrefix));
    const cancelled = warehouseOrders.filter((order) => order.state === 'cancel').length;
    const draft = warehouseOrders.filter((order) => order.state === 'draft').length;
    const eligible = warehouseOrders.filter((order) => !['cancel', 'draft'].includes(order.state));
    const reportEnd = `${toDate} 23:59:59`;
    const completed = eligible.filter((order) => (
      order.state === 'done'
      && Boolean(order.date_finished)
      && String(order.date_finished).slice(0, 19) <= reportEnd
    )).length;
    const open = Math.max(0, eligible.length - completed);

    return {
      created: warehouseOrders.length,
      eligible: eligible.length,
      completed,
      open,
      cancelled,
      draft,
      completionPercent: eligible.length > 0 ? Math.round((completed / eligible.length) * 100) : 100,
      details: `MOs created ${fromDate} to ${toDate}: ${warehouseOrders.length} total | ${eligible.length} eligible | ${completed} completed by period end | ${open} open | ${cancelled} cancelled | ${draft} draft`,
    };
  }

  /**
   * Get raw material moves (components) for a manufacturing order.
   * Returns the component product, quantity needed, and availability state.
   */
  async getManufacturingOrderComponents(moId: number) {
    return this.request<Array<{
      id: number;
      product_id: [number, string];
      product_uom_qty: number;
      quantity: number;
      state: string;
      forecast_availability: number | string | null | boolean;
    }>>(
      'stock.move',
      'search_read',
      {
        domain: [
          ['raw_material_production_id', '=', moId],
        ],
        fields: ['id', 'product_id', 'product_uom_qty', 'quantity', 'state', 'forecast_availability'],
        limit: 50,
      },
    );
  }

  /**
   * Check if a sales order has linked POs and return the state of the first PO found.
   * Returns null if no PO exists, or the PO state (draft, sent, purchase, done, cancel).
   */
  async getRelatedPurchaseOrderState(soName: string): Promise<string | null> {
    if (!soName) return null;

    const orders = await this.request<Array<{ id: number }>>(
      'sale.order',
      'search_read',
      {
        domain: [['name', '=', soName]],
        fields: ['id'],
        limit: 1,
      },
    );

    if (!orders.length) return null;

    const pos = await this.request<Array<{ id: number; state: string }>>(
      'purchase.order',
      'search_read',
      {
        domain: [['origin', 'ilike', soName]],
        fields: ['id', 'state'],
        limit: 1,
      },
    );

    return pos.length > 0 ? pos[0].state : null;
  }

  /**
   * Get raw material moves (components) for multiple manufacturing orders in a single request.
   */
  async getBulkManufacturingOrderComponents(moIds: number[]) {
    if (!moIds || moIds.length === 0) return [];
    return this.request<Array<{
      id: number;
      product_id: [number, string];
      product_uom_qty: number;
      quantity: number;
      state: string;
      forecast_availability: number | string | null | boolean;
      raw_material_production_id: [number, string];
    }>>(
      'stock.move',
      'search_read',
      {
        domain: [
          ['raw_material_production_id', 'in', moIds],
        ],
        fields: ['id', 'product_id', 'product_uom_qty', 'quantity', 'state', 'forecast_availability', 'raw_material_production_id'],
        limit: 1000,
      },
    );
  }

  /**
   * Get purchase order states for multiple sale order names in a single request.
   */
  async getBulkRelatedPurchaseOrderStates(soNames: string[]): Promise<Map<string, string>> {
    const stateMap = new Map<string, string>();
    if (!soNames || soNames.length === 0) return stateMap;

    const pos = await this.request<Array<{ id: number; state: string; origin: string | false }>>(
      'purchase.order',
      'search_read',
      {
        domain: [['origin', 'in', soNames]],
        fields: ['id', 'state', 'origin'],
        limit: 5000,
      },
    );

    for (const po of pos) {
      if (po.origin) {
        // Prefer the most advanced relevant state when an SO has multiple POs.
        const existing = stateMap.get(po.origin);
        const rank = (state: string) => state === 'purchase' ? 3 : state === 'to approve' ? 2 : state === 'sent' ? 1 : 0;
        if (!existing || rank(po.state) > rank(existing)) stateMap.set(po.origin, po.state);
      }
    }
    return stateMap;
  }

  async getManufacturingOrderBoardProcurement(moId: number) {
    const [productions, components] = await Promise.all([
      this.searchReadRecords<{
        id: number;
        name: string;
        origin: string | null;
      }>('mrp.production', {
        domain: [['id', '=', moId]],
        fields: ['id', 'name', 'origin'],
        limit: 1,
      }),
      this.searchReadRecords<{
        product_id: [number, string] | false;
        product_uom_qty: number;
        quantity: number;
        state: string;
        forecast_availability: number | string | null | boolean;
      }>('stock.move', {
        domain: [['raw_material_production_id', '=', moId]],
        fields: ['product_id', 'product_uom_qty', 'quantity', 'state', 'forecast_availability'],
        limit: 1000,
      }),
    ]);
    const production = productions[0];
    if (!production) {
      throw new OdooClientError('Manufacturing order was not found in Odoo.');
    }
    const unavailableBoards = components.filter((component) => {
      const productName = Array.isArray(component.product_id) ? component.product_id[1] : '';
      if (!isBoardProductName(productName) || ['done', 'cancel', 'draft', 'assigned'].includes(component.state)) {
        return false;
      }
      return ['confirmed', 'waiting', 'partially_available'].includes(component.state)
        || !component.forecast_availability
        || component.forecast_availability === 'unavailable';
    }).map((component) => ({
      name: Array.isArray(component.product_id) ? component.product_id[1] : 'Board',
      required: Number(component.product_uom_qty || 0),
      available: Number(component.quantity || 0),
    }));

    const purchaseOrders = production.origin
      ? await this.searchReadRecords<{
          id: number;
          name: string;
          state: string;
          partner_id: [number, string] | false;
        }>('purchase.order', {
          domain: [['origin', '=', production.origin], ['state', '!=', 'cancel']],
          fields: ['id', 'name', 'state', 'partner_id'],
          order: 'id desc',
          limit: 100,
        })
      : [];

    return {
      moId: production.id,
      moName: production.name,
      origin: production.origin || null,
      waitingForBoards: unavailableBoards.length > 0,
      unavailableBoards,
      purchaseOrders: purchaseOrders.map((po) => ({
        id: po.id,
        name: po.name,
        state: po.state,
        supplier: Array.isArray(po.partner_id) ? po.partner_id[1] : null,
      })),
    };
  }

  /**
   * Approve all pending purchase orders linked to a manufacturing order.
   * The configured Odoo connection must belong to an account with purchase
   * approval rights (the production deployment uses dbadmin for this).
   */
  async approvePurchaseOrdersForShopFloor(
    purchaseOrders: Array<{ id: number; name: string; state: string }>,
  ): Promise<Array<{ id: number; name: string; state: string }>> {
    const results: Array<{ id: number; name: string; state: string }> = [];
    for (const purchaseOrder of purchaseOrders) {
      let current = String(purchaseOrder.state || '').toLowerCase();
      if (['draft', 'sent'].includes(current)) {
        await this.callRecordMethod<unknown>('purchase.order', 'button_confirm', [purchaseOrder.id]);
        const confirmed = await this.readRecords<{ state: string }>('purchase.order', [purchaseOrder.id], ['state']);
        current = String(confirmed[0]?.state || '').toLowerCase();
      }
      if (current === 'to approve') {
        await this.callRecordMethod<unknown>('purchase.order', 'button_approve', [purchaseOrder.id]);
      }
      const refreshed = await this.readRecords<{ id: number; name: string; state: string }>(
        'purchase.order',
        [purchaseOrder.id],
        ['id', 'name', 'state'],
      );
      const updated = refreshed[0];
      if (!updated || !['purchase', 'done'].includes(String(updated.state || '').toLowerCase())) {
        throw new OdooClientError(
          `Purchase order ${purchaseOrder.name || purchaseOrder.id} could not be approved. Current state: ${updated?.state || 'unknown'}.`,
        );
      }
      results.push(updated);
    }
    return results;
  }

  /**
   * Get client names for multiple sale order names in a single request.
   */
  async getBulkSaleOrderClients(soNames: string[]): Promise<Map<string, string>> {
    const clientMap = new Map<string, string>();
    if (!soNames || soNames.length === 0) return clientMap;
    const sos = await this.request<Array<{ name: string; partner_id: [number, string] | false }>>(
      'sale.order',
      'search_read',
      {
        domain: [['name', 'in', soNames]],
        fields: ['name', 'partner_id'],
        limit: 5000,
      },
    );
    for (const so of sos) {
      if (so.name && so.partner_id) {
        clientMap.set(so.name, so.partner_id[1]);
      }
    }
    return clientMap;
  }

  /**
   * Get confirmation timestamps for multiple sale order names in a single request.
   */
  async getBulkSaleOrderConfirmationDates(soNames: string[]): Promise<Map<string, string>> {
    const dateMap = new Map<string, string>();
    if (!soNames || soNames.length === 0) return dateMap;
    const sos = await this.request<Array<{ name: string; date_order: string | null }>>(
      'sale.order',
      'search_read',
      {
        domain: [['name', 'in', soNames]],
        fields: ['name', 'date_order'],
        limit: 5000,
      },
    );
    for (const so of sos) {
      if (so.name && so.date_order) {
        dateMap.set(so.name, so.date_order);
      }
    }
    return dateMap;
  }

  /**
   * Get payslips for an employee.
   */
  async getEmployeePayslips(employeeId: number, limit = 12) {
    return this.request<Array<{
      id: number;
      name: string;
      date_from: string;
      date_to: string;
      state: string;
      struct_id: [number, string];
    }>>(
      'hr.payslip',
      'search_read',
      {
        domain: [['employee_id', '=', employeeId]],
        fields: ['id', 'name', 'date_from', 'date_to', 'state', 'struct_id'],
        order: 'date_from desc',
        limit,
      },
    );
  }

  /**
   * Get payslip line totals (gross, net, deductions).
   */
  async getPayslipLines(payslipId: number) {
    return this.request<Array<{
      id: number;
      name: string;
      code: string;
      total: number;
      category_id: [number, string] | null;
    }>>(
      'hr.payslip.line',
      'search_read',
      {
        domain: [['slip_id', '=', payslipId]],
        fields: ['id', 'name', 'code', 'total', 'category_id'],
      },
    );
  }

  /**
   * Get payslip display name for download filename.
   */
  async getPayslipName(payslipId: number): Promise<string> {
    const slips = await this.request<Array<{ name: string }>>(
      'hr.payslip', 'search_read',
      { domain: [['id', '=', payslipId]], fields: ['name'], limit: 1 },
    );
    return slips[0]?.name || `payslip-${payslipId}`;
  }

  /**
   * Get payslip PDF by fetching the generated report attachment from ir.attachment.
   * Same approach as vendor bills — looks up the PDF attachment linked to the payslip.
   */
  async getPayslipPdf(payslipId: number): Promise<{ filename: string; data: Buffer } | null> {
    try {
      // 1. Try fetching via Odoo Documents app link (document_access_url) first
      const slips = await this.request<Array<{ name: string; document_access_url?: string | false }>>(
        'hr.payslip',
        'search_read',
        {
          domain: [['id', '=', payslipId]],
          fields: ['name', 'document_access_url'],
          limit: 1,
        }
      );

      if (slips.length > 0 && slips[0].document_access_url) {
        const accessUrl = slips[0].document_access_url;
        const match = accessUrl.match(/\/documents\/([a-zA-Z0-9_\-]+)/);
        if (match && match[1]) {
          const token = match[1];
          const downloadUrl = `${this.baseUrl}/documents/content/${token}`;
          try {
            const response = await axios.get(downloadUrl, {
              responseType: 'arraybuffer',
              timeout: 15000,
            });
            if (response.status === 200 && response.data) {
              return {
                filename: slips[0].name ? `${slips[0].name.replace(/[<>:"/\\|?*]/g, '').trim()}.pdf` : `payslip-${payslipId}.pdf`,
                data: Buffer.from(response.data),
              };
            }
          } catch (downloadErr) {
            console.warn(`[odooClient] Failed to download payslip via Documents app link:`, downloadErr instanceof Error ? downloadErr.message : downloadErr);
          }
        }
      }

      // 2. Fall back to searching ir.attachment
      const attachments = await this.request<Array<{ id: number; name: string; datas: string; mimetype: string }>>(
        'ir.attachment',
        'search_read',
        {
          domain: [
            ['res_model', '=', 'hr.payslip'],
            ['res_id', '=', payslipId],
            ['mimetype', '=', 'application/pdf'],
          ],
          fields: ['id', 'name', 'datas', 'mimetype'],
          limit: 1,
          order: 'create_date desc',
        },
      );

      if (attachments.length > 0 && attachments[0].datas) {
        return {
          filename: attachments[0].name || `payslip-${payslipId}.pdf`,
          data: Buffer.from(attachments[0].datas, 'base64'),
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get failed checkouts for an employee (e.g. worked hours > 16 or missing check out for > 24 hours).
   */
  async getFailedCheckouts(employeeId: number): Promise<Array<{ date: string; hours: number; nextDayCheckIn: string | null }>> {
    try {
      const records = await this.request<Array<{ check_in: string; check_out: string | false; worked_hours: number }>>(
        'hr.attendance',
        'search_read',
        {
          domain: [
            ['employee_id', '=', employeeId],
            '|',
            ['check_out', '=', false],
            ['worked_hours', '>', 16],
          ],
          fields: ['check_in', 'check_out', 'worked_hours'],
          order: 'check_in desc',
          limit: 10,
        }
      );

      const recentRecords = await this.request<Array<{ check_in: string; check_out: string | false; worked_hours: number }>>(
        'hr.attendance',
        'search_read',
        {
          domain: [['employee_id', '=', employeeId]],
          fields: ['check_in', 'check_out', 'worked_hours'],
          order: 'check_in asc',
          limit: 100,
        },
      );
      const failed: Array<{ date: string; hours: number; nextDayCheckIn: string | null }> = [];
      const now = new Date();
      
      for (const rec of records) {
        if (!rec.check_in) continue;
        const checkInDate = new Date(rec.check_in.includes('T') ? rec.check_in : rec.check_in.replace(' ', 'T') + 'Z');
        
        // If check out is missing and it's been more than 24 hours since check in, or worked hours > 16
        if ((!rec.check_out && (now.getTime() - checkInDate.getTime()) > 24 * 60 * 60 * 1000) || rec.worked_hours > 16) {
          const dateStr = checkInDate.toISOString().split('T')[0];
          const nextDate = new Date(checkInDate);
          nextDate.setDate(nextDate.getDate() + 1);
          const nextDayCheckIn = recentRecords.find((candidate) => {
            if (!candidate.check_in) return false;
            const candidateDate = new Date(candidate.check_in.includes('T') ? candidate.check_in : candidate.check_in.replace(' ', 'T') + 'Z');
            return candidateDate.toISOString().slice(0, 10) === nextDate.toISOString().slice(0, 10) && candidateDate > checkInDate;
          })?.check_in || null;
          failed.push({ date: dateStr, hours: Math.round(rec.worked_hours * 10) / 10, nextDayCheckIn });
        }
      }
      return failed;
    } catch {
      return [];
    }
  }

  /**
   * Get the manufacturing team's month-to-date performance through the latest
   * completed reporting day. Before 6 PM, today is still in progress and is not
   * included; after 6 PM, today's completed work is included.
   * 
   * Rating factors (last calendar month):
   * 1. Overdue MOs: MOs linked to these work centers that are still not done and past deadline
   * 2. Completion speed: How many days from SO confirmation (date_order) to MO completion (date_finished)
   * 3. Low-qty slowness: If product_qty is low (<=5) but MO took >2 days to complete
   * 4. WO duration ratio: Actual duration vs expected duration per work order
   * 
   * Final score = weighted average of sub-scores.
   */
  async getWorkCenterPerformance(
    employeeId: number,
    employeeName: string = ''
  ): Promise<{
    percentage: number;
    color: string;
    totalOrders: number;
    overduePending: number;
    avgDaysToComplete: number;
    slowLowQty: number;
    details: string;
  } | null> {
    try {
      const wcDomain: any[] = [];

      // 1. Find allowed work centers
      const workcenters = await this.request<Array<{ id: number; name: string }>>(
        'mrp.workcenter',
        'search_read',
        { domain: wcDomain, fields: ['id', 'name'], limit: 10 }
      );

      if (!workcenters || workcenters.length === 0) return null;
      const wcIds = workcenters.map((w) => w.id);

      // Date range: current reporting month through the latest completed day.
      // The route caches this result by the same 6 PM reporting-day boundary,
      // so Odoo is called only once for each completed reporting day.
      const reportParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
      }).formatToParts(new Date());
      const reportValue = (type: string) => reportParts.find((part) => part.type === type)?.value || '';
      const localToday = `${reportValue('year')}-${reportValue('month')}-${reportValue('day')}`;
      const reportDate = new Date(`${localToday}T00:00:00Z`);
      if (Number(reportValue('hour')) < 18) reportDate.setUTCDate(reportDate.getUTCDate() - 1);
      const reportDay = reportDate.toISOString().slice(0, 10);
      const firstDayStr = `${MANUFACTURING_PERFORMANCE_START_DATE} 00:00:00`;
      const lastDayStr = `${reportDay} 23:59:59`;

      // 2. Fetch completed WOs for these work centers last month
      const workorders = await this.request<Array<{
        id: number;
        duration: number;
        duration_expected: number;
        date_start: string;
        date_finished: string;
        state: string;
        production_id: [number, string] | false;
        qty_produced: number;
        qty_production: number;
      }>>(
        'mrp.workorder',
        'search_read',
        {
          domain: [
            ['workcenter_id', 'in', wcIds],
            ['state', '=', 'done'],
            ['date_finished', '>=', firstDayStr],
            ['date_finished', '<=', lastDayStr],
          ],
          fields: ['duration', 'duration_expected', 'date_start', 'date_finished', 'production_id', 'qty_produced', 'qty_production'],
          limit: 200,
        }
      );

      if (!workorders || workorders.length === 0) return null;

      // 3. Count OVERDUE MOs that are still NOT done (linked to these WCs)
      const overdueMos = await this.request<Array<{
        id: number;
        product_qty: number;
      }>>(
        'mrp.production',
        'search_read',
        {
          domain: [
          ['date_deadline', '!=', false],
            ['date_deadline', '>=', firstDayStr],
            ['state', 'not in', ['done', 'cancel']],
            ['date_deadline', '<=', lastDayStr],
          ],
          fields: ['id', 'product_qty'],
          limit: 500,
        }
      );
      const overduePendingMos = overdueMos ? overdueMos.length : 0;

      // 3b. Count overdue WOs that are still open by the end of last month.
      // These are work orders that should have been completed but were still active.
      const overdueWorkorders = await this.request<Array<{
        id: number;
        duration_expected: number;
        date_start: string | null;
        qty_production: number;
        qty_produced: number;
        state: string;
      }>>(
        'mrp.workorder',
        'search_read',
        {
          domain: [
          ['workcenter_id', 'in', wcIds],
          ['state', 'not in', ['done', 'cancel']],
          ['date_start', '!=', false],
          ['date_start', '>=', firstDayStr],
          ['date_start', '<=', lastDayStr],
          ],
          fields: ['id', 'duration_expected', 'date_start', 'qty_production', 'qty_produced', 'state'],
          limit: 500,
        }
      );
      const monthEnd = new Date(`${reportDay}T23:59:59Z`);
      const overduePendingWos = (overdueWorkorders || []).filter((wo) => {
        if (!wo.date_start || wo.duration_expected <= 0) {
          return false;
        }

        const startedAt = parseOdooDateTime(wo.date_start);
        if (!startedAt) {
          return false;
        }

        const elapsedHours = (monthEnd.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
        return elapsedHours > wo.duration_expected;
      }).length;

      // 4. Get unique MO IDs from WOs to fetch their MO details
      const moIds = [...new Set(workorders.filter(w => w.production_id && Array.isArray(w.production_id)).map(w => (w.production_id as [number, string])[0]))];

      let moMap: Map<number, { date_start: string; date_finished: string; product_qty: number; origin: string; date_deadline: string }> = new Map();
      if (moIds.length > 0) {
        const mos = await this.request<Array<{
          id: number;
          date_start: string;
          date_finished: string;
          product_qty: number;
          origin: string;
          date_deadline: string;
        }>>(
          'mrp.production',
          'search_read',
          {
            domain: [['id', 'in', moIds]],
            fields: ['id', 'date_start', 'date_finished', 'product_qty', 'origin', 'date_deadline'],
          }
        );
        for (const mo of mos) {
          moMap.set(mo.id, mo);
        }
      }

      // 5. Fetch SO confirmation dates for origins
      const origins = [...new Set([...moMap.values()].filter(m => m.origin).map(m => m.origin))];
      let soDateMap: Map<string, string> = new Map();
      if (origins.length > 0) {
        const sos = await this.request<Array<{ name: string; date_order: string }>>(
          'sale.order',
          'search_read',
          {
            domain: [['name', 'in', origins]],
            fields: ['name', 'date_order'],
          }
        );
        for (const so of sos) {
          soDateMap.set(so.name, so.date_order);
        }
      }

      // ===== REAL KPI =====
      // We score actual order outcomes, not an averaged mix of duration/speed metrics.
      // Completed MOs get full or partial credit based on time-to-finish.
      // Open overdue MOs/WOs are included in the denominator as unfinished backlog.
      let completedOrders = 0;
      let completedWeight = 0;
      let onTimeWeight = 0;
      let sameDayWeight = 0;
      let lowQtySameDayWeight = 0;
      let lateCompletedWeight = 0;
      let slowLowQty = 0;
      let completionDays: number[] = [];
      const minDate = new Date(`${MANUFACTURING_PERFORMANCE_START_DATE}T00:00:00Z`);
      for (const mo of moMap.values()) {
        if (!mo.date_finished || !mo.origin) continue;
        const soDate = soDateMap.get(mo.origin);
        const soConfirmed = parseOdooDateTime(soDate);
        const moFinished = parseOdooDateTime(mo.date_finished);
        const moStarted = parseOdooDateTime(mo.date_start);
        if (!soConfirmed || !moFinished) continue;
        if (soConfirmed.getTime() < minDate.getTime()) continue;

        const weight = Math.max(1, Number(mo.product_qty || 0));
        const finishDays = (moFinished.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24);
        const startDays = moStarted ? (moStarted.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24) : null;
        const sameDayStartFinish = moStarted !== null && moStarted.toDateString() === moFinished.toDateString();
        const lowQty = weight <= 5;

        completedOrders += 1;
        completedWeight += weight;
        if (finishDays >= 0) {
          completionDays.push(finishDays);
        }

        if (finishDays >= 0 && finishDays <= 3) {
          if (sameDayStartFinish) {
            sameDayWeight += weight;
            if (lowQty) {
              lowQtySameDayWeight += weight;
              onTimeWeight += weight;
            } else {
              onTimeWeight += weight * 0.5;
            }
          } else {
            onTimeWeight += weight;
          }
        } else {
          lateCompletedWeight += weight;
        }

        if (lowQty && ((startDays !== null && startDays > 2) || finishDays > 3)) {
          slowLowQty++;
        }
      }

      const overdueMoWeight = (overdueMos || []).reduce((sum, mo) => sum + Math.max(1, Number(mo.product_qty || 0)), 0);
      const overdueWoWeight = (overdueWorkorders || []).reduce(
        (sum, wo) => sum + Math.max(1, Number(wo.qty_production || wo.qty_produced || 0)),
        0,
      );
      const totalWeight = completedWeight + overdueMoWeight + overdueWoWeight;
      const overdueTotal = overduePendingMos + overduePendingWos;
      const percentage = totalWeight > 0
        ? Math.min(100, Math.max(0, Math.round((onTimeWeight / totalWeight) * 100)))
        : 0;
      const avgDays = completionDays.length > 0
        ? completionDays.reduce((sum, days) => sum + days, 0) / completionDays.length
        : 0;

      let color = 'red';
      if (percentage >= 75) color = 'green';
      else if (percentage >= 50) color = 'orange';

      // Build a human-readable detail string
      const details = `Period: 5 Aug 2026 to ${reportDay} | Real rate: ${percentage}% | Avg finish: ${avgDays.toFixed(1)} days from SO confirmation | On-time qty: ${Math.round(onTimeWeight)} | Same-day qty: ${Math.round(sameDayWeight)} | Low-qty same-day: ${Math.round(lowQtySameDayWeight)} | Late qty: ${Math.round(lateCompletedWeight)} | Open backlog: ${overduePendingMos} MO, ${overduePendingWos} WO | Low-qty slow: ${slowLowQty}`;

      return {
        percentage,
        color,
        totalOrders: completedOrders + overdueTotal,
        overduePending: overdueTotal,
        avgDaysToComplete: Math.round(avgDays * 10) / 10,
        slowLowQty,
        details,
      };
    } catch (err) {
      console.warn('[odooClient] Failed to fetch work center performance:', err);
      return null;
    }
  }

  /**
   * Get a June/last-month manufacturing timing summary for the employee's work centers.
   * This keeps start timing and finish timing separate so same-day start/finish orders
   * do not overstate the success rate.
   */
  async getManufacturingTimingSummary(
    employeeId: number,
    employeeName: string = '',
  ): Promise<{
    monthLabel: string;
    totalOrders: number;
    startedWithin1Day: number;
    finishedWithin3Days: number;
    sameDayStartFinish: number;
    withSalesOrders: number;
  } | null> {
    try {
      const wcDomain: any[] = [];

      const workcenters = await this.request<Array<{ id: number; name: string }>>(
        'mrp.workcenter',
        'search_read',
        { domain: wcDomain, fields: ['id', 'name'], limit: 10 },
      );

      if (!workcenters || workcenters.length === 0) return null;
      const wcIds = workcenters.map((w) => w.id);

      const now = new Date();
      const firstDayStr = `${MANUFACTURING_PERFORMANCE_START_DATE} 00:00:00`;
      const lastDayStr = now.toISOString().split('T')[0] + ' 23:59:59';
      const monthLabel = `From 5 August 2026`;

      const workorders = await this.request<Array<{
        id: number;
        date_start: string;
        date_finished: string;
        production_id: [number, string] | false;
      }>>(
        'mrp.workorder',
        'search_read',
        {
          domain: [
            ['workcenter_id', 'in', wcIds],
            ['state', '=', 'done'],
            ['date_start', '>=', firstDayStr],
            ['date_start', '<=', lastDayStr],
          ],
          fields: ['date_start', 'date_finished', 'production_id'],
          limit: 500,
        },
      );

      if (!workorders || workorders.length === 0) {
        return {
          monthLabel,
          totalOrders: 0,
          startedWithin1Day: 0,
          finishedWithin3Days: 0,
          sameDayStartFinish: 0,
          withSalesOrders: 0,
        };
      }

      const moIds = [...new Set(workorders.filter((w) => w.production_id && Array.isArray(w.production_id)).map((w) => (w.production_id as [number, string])[0]))];
      const moMap = new Map<number, { date_start: string; date_finished: string; origin: string }>();

      if (moIds.length > 0) {
        const mos = await this.request<Array<{
          id: number;
          date_start: string;
          date_finished: string;
          origin: string;
        }>>(
          'mrp.production',
          'search_read',
          {
            domain: [['id', 'in', moIds]],
            fields: ['id', 'date_start', 'date_finished', 'origin'],
          },
        );
        for (const mo of mos) {
          moMap.set(mo.id, mo);
        }
      }

      const origins = [...new Set([...moMap.values()].filter((m) => m.origin).map((m) => m.origin))];
      const soDateMap = new Map<string, string>();
      if (origins.length > 0) {
        const sos = await this.request<Array<{ name: string; date_order: string }>>(
          'sale.order',
          'search_read',
          {
            domain: [['name', 'in', origins]],
            fields: ['name', 'date_order'],
          },
        );
        for (const so of sos) {
          soDateMap.set(so.name, so.date_order);
        }
      }

      let startedWithin1Day = 0;
      let finishedWithin3Days = 0;
      let sameDayStartFinish = 0;
      let withSalesOrders = 0;
      const minDate = new Date(`${MANUFACTURING_PERFORMANCE_START_DATE}T00:00:00Z`);

      for (const mo of moMap.values()) {
        if (!mo.origin || !mo.date_start || !mo.date_finished) {
          continue;
        }

        const soConfirmed = parseOdooDateTime(soDateMap.get(mo.origin));
        const moStarted = parseOdooDateTime(mo.date_start);
        const moFinished = parseOdooDateTime(mo.date_finished);
        if (!soConfirmed || !moStarted || !moFinished) {
          continue;
        }
        if (soConfirmed.getTime() < minDate.getTime()) {
          continue;
        }

        withSalesOrders += 1;

        const startDeltaHours = (moStarted.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60);
        const finishDeltaDays = (moFinished.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24);

        if (startDeltaHours >= 0 && startDeltaHours <= 24) {
          startedWithin1Day += 1;
        }

        if (finishDeltaDays >= 0 && finishDeltaDays <= 3) {
          finishedWithin3Days += 1;
        }

        if (moStarted.toDateString() === moFinished.toDateString()) {
          sameDayStartFinish += 1;
        }
      }

      return {
        monthLabel,
        totalOrders: workorders.length,
        startedWithin1Day,
        finishedWithin3Days,
        sameDayStartFinish,
        withSalesOrders,
      };
    } catch (err) {
      console.warn('[odooClient] Failed to fetch manufacturing timing summary:', err);
      return null;
    }
  }

  /**
   * Get raw manufacturing timing rows for charting by work center or area.
   * This is scoped to the employee's allowed work centers.
   */
  async getManufacturingTimelineData(
    employeeId: number,
    employeeName: string = '',
  ): Promise<{
    monthLabel: string;
    workCenters: Array<{ id: number; name: string }>;
    records: Array<{
      moName: string;
      workCenter: string;
      product: string;
      origin: string | null;
      startedAt: string;
      finishedAt: string;
    }>;
  } | null> {
    try {
      const wcDomain: any[] = [];

      const workcenters = await this.request<Array<{ id: number; name: string }>>(
        'mrp.workcenter',
        'search_read',
        { domain: wcDomain, fields: ['id', 'name'], limit: 20 },
      );

      if (!workcenters || workcenters.length === 0) return null;
      const wcIds = workcenters.map((w) => w.id);

      const now = new Date();
      const firstDayStr = `${MANUFACTURING_PERFORMANCE_START_DATE} 00:00:00`;
      const lastDayStr = now.toISOString().split('T')[0] + ' 23:59:59';
      const monthLabel = `From 5 August 2026`;

      const workorders = await this.request<Array<{
        id: number;
        date_start: string | null;
        date_finished: string | null;
        production_id: [number, string] | false | null;
        workcenter_id: [number, string] | false | null;
      }>>(
        'mrp.workorder',
        'search_read',
        {
          domain: [
            ['workcenter_id', 'in', wcIds],
            ['state', '=', 'done'],
            ['date_finished', '>=', firstDayStr],
            ['date_finished', '<=', lastDayStr],
          ],
          fields: ['id', 'date_start', 'date_finished', 'production_id', 'workcenter_id'],
          limit: 2500,
          order: 'date_finished desc, id desc',
        },
      );

      if (!workorders || workorders.length === 0) {
        return {
          monthLabel,
          workCenters: workcenters,
          records: [],
        };
      }

      const moIds = [...new Set(workorders
        .filter((w) => w.production_id && Array.isArray(w.production_id))
        .map((w) => (w.production_id as [number, string])[0]))];

      const moMap = new Map<number, { origin: string | null; product: string }>();
      if (moIds.length > 0) {
        const mos = await this.request<Array<{
          id: number;
          origin: string | null;
          product_id: [number, string] | false | null;
        }>>(
          'mrp.production',
          'search_read',
          {
            domain: [['id', 'in', moIds]],
            fields: ['id', 'origin', 'product_id'],
          },
        );
        for (const mo of mos) {
          moMap.set(mo.id, {
            origin: mo.origin || null,
            product: Array.isArray(mo.product_id) ? mo.product_id[1] : '',
          });
        }
      }

      const records = workorders
        .map((wo) => {
          const production = Array.isArray(wo.production_id) ? moMap.get(wo.production_id[0]) : null;
          const startedAt = wo.date_start ? parseOdooDateTime(wo.date_start) : null;
          const finishedAt = wo.date_finished ? parseOdooDateTime(wo.date_finished) : null;
          const workCenter = Array.isArray(wo.workcenter_id) ? wo.workcenter_id[1] : '';
          const moName = Array.isArray(wo.production_id) ? wo.production_id[1] : '';

          if (!startedAt || !finishedAt) {
            return null;
          }

          return {
            moName,
            workCenter,
            product: production?.product || '',
            origin: production?.origin || null,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));

      return {
        monthLabel,
        workCenters: workcenters,
        records,
      };
    } catch (err) {
      console.warn('[odooClient] Failed to fetch manufacturing timeline data:', err);
      return null;
    }
  }

  /**
   * Compare board receipts expected from incoming stock moves against board rows
   * captured in physical inventory history. Edge banding is excluded.
   */
  async getBoardRegistrationSummary(stockScope?: {
    warehouseId?: string;
    pickingTypeId?: string;
    locationId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    monthLabel: string;
    registeredBoards: number;
    expectedBoards: number;
    missingBoards: number;
    registeredMoves: number;
    expectedMoves: number;
    coveragePercent: number;
    details: string;
  } | null> {
    try {
      const targetCompanyId = await this.getTargetCompanyId();
      const now = new Date();
      const defaultFromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const defaultToDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(stockScope?.fromDate || ''))
        ? String(stockScope!.fromDate)
        : defaultFromDate;
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(stockScope?.toDate || ''))
        ? String(stockScope!.toDate)
        : defaultToDate;
      const firstDayOfMonth = new Date(`${fromDate}T00:00:00`);
      const lastDayOfMonth = new Date(`${toDate}T23:59:59`);
      const firstDayStr = `${fromDate} 00:00:00`;
      const lastDayStr = `${toDate} 23:59:59`;
      const monthLabel = fromDate === defaultFromDate && toDate === defaultToDate
        ? now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
        : `${fromDate} to ${toDate}`;

      const locationId = Number(stockScope?.locationId || 0) || null;
      const pickingTypeId = Number(stockScope?.pickingTypeId || 0) || null;
      const warehouseId = Number(stockScope?.warehouseId || 0) || null;

      const cuttingOrders = await this.request<Array<{
        id: number;
        name: string;
        origin: string | null;
        product_id?: [number, string] | false | null;
        product_qty?: number | null;
        date_start?: string | null;
        date_finished?: string | null;
        create_date?: string | null;
      }>>(
        'mrp.production',
          'search_read',
          {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['state', 'not in', ['cancel']],
              ['origin', '!=', false],
            ],
            fields: ['id', 'name', 'origin', 'product_id', 'product_qty', 'date_start', 'date_finished', 'create_date'],
            limit: 5000,
            order: 'date_start desc, id desc',
          },
      );

      const cuttingByOrigin = cuttingOrders.filter((mo) => isCuttingWorkOrderProductName(Array.isArray(mo.product_id) ? mo.product_id[1] : ''));
      const originNames = [...new Set(cuttingByOrigin.map((mo) => mo.origin).filter((origin): origin is string => Boolean(origin)))];

      const saleOrders = originNames.length > 0
        ? await this.request<Array<{
          id: number;
          name: string;
          date_order?: string | null;
        }>>(
          'sale.order',
          'search_read',
          {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['name', 'in', originNames],
            ],
            fields: ['id', 'name', 'date_order'],
            limit: originNames.length,
            order: 'date_order desc, id desc',
          },
        )
        : [];
      const saleOrderMap = new Map<string, { id: number; date_order: string | null }>();
      saleOrders.forEach((so) => {
        saleOrderMap.set(so.name, { id: so.id, date_order: so.date_order || null });
      });

      const purchaseOrders = originNames.length > 0
        ? await this.request<Array<{
          id: number;
          name: string;
          origin: string | false | null;
          state?: string | null;
        }>>(
          'purchase.order',
          'search_read',
          {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['origin', 'in', originNames],
            ],
            fields: ['id', 'name', 'origin', 'state'],
            limit: 2000,
            order: 'id desc',
          },
        )
        : [];
      const purchaseOrderIds = purchaseOrders.map((po) => po.id);
      const purchaseLines = purchaseOrderIds.length > 0
        ? await this.request<Array<{
          id: number;
          order_id: [number, string] | false | null;
          product_id?: [number, string] | false | null;
          product_qty?: number | null;
        }>>(
          'purchase.order.line',
          'search_read',
          {
            domain: [
              ['order_id', 'in', purchaseOrderIds],
            ],
            fields: ['id', 'order_id', 'product_id', 'product_qty'],
            limit: 5000,
            order: 'id asc',
          },
        )
        : [];
      const purchaseLinesByOrigin = new Map<string, Array<{
        id: number;
        product_id?: [number, string] | false | null;
        product_qty?: number | null;
      }>>();
      const purchaseOrderById = new Map<number, string>();
      purchaseOrders.forEach((po) => {
        if (po.origin) {
          purchaseOrderById.set(po.id, po.origin);
        }
      });
      purchaseLines.forEach((line) => {
        if (!Array.isArray(line.order_id)) {
          return;
        }
        const origin = purchaseOrderById.get(line.order_id[0]);
        if (!origin) {
          return;
        }
        if (!purchaseLinesByOrigin.has(origin)) {
          purchaseLinesByOrigin.set(origin, []);
        }
        purchaseLinesByOrigin.get(origin)!.push(line);
      });

      const physicalMoves = await this.request<Array<{
        id: number;
        product_id?: [number, string] | false | null;
        quantity?: number | null;
        product_uom_qty?: number | null;
        reference?: string | null;
        origin?: string | null;
        state?: string | null;
        is_inventory?: boolean | null;
        location_dest_id?: [number, string] | false | null;
        company_id?: [number, string] | false | null;
        date?: string | null;
      }>>(
        'stock.move',
        'search_read',
          {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['state', '=', 'done'],
              ['date', '>=', firstDayStr],
              ['date', '<=', lastDayStr],
            ],
          fields: ['id', 'product_id', 'quantity', 'product_uom_qty', 'reference', 'origin', 'state', 'is_inventory', 'location_dest_id', 'company_id', 'date'],
          limit: 5000,
          order: 'date desc, id desc',
        },
      );

      const boardPurchasesByOrigin = new Set<string>();
      for (const origin of originNames) {
        const lines = purchaseLinesByOrigin.get(origin) || [];
        if (lines.some((line) => isBoardProductName(Array.isArray(line.product_id) ? line.product_id[1] : ''))) {
          boardPurchasesByOrigin.add(origin);
        }
      }

      const dueCuttingOrders = cuttingByOrigin.filter((mo) => {
        if (!mo.origin) {
          return false;
        }
        if (boardPurchasesByOrigin.has(mo.origin)) {
          return false;
        }
        const soDateRaw = saleOrderMap.get(mo.origin)?.date_order || null;
        if (!soDateRaw) return false;
        const soDate = parseOdooDateTime(soDateRaw);
        if (!soDate) return false;
        return soDate >= firstDayOfMonth && soDate <= lastDayOfMonth;
      });

      const dueMoIds = dueCuttingOrders.map((mo) => mo.id);
      const moComponents = dueMoIds.length > 0
        ? await this.getBulkManufacturingOrderComponents(dueMoIds)
        : [];
      const componentsByMoId = new Map<number, typeof moComponents>();
      moComponents.forEach((c) => {
        if (c.raw_material_production_id) {
          const moId = c.raw_material_production_id[0];
          if (!componentsByMoId.has(moId)) componentsByMoId.set(moId, []);
          componentsByMoId.get(moId)!.push(c);
        }
      });

      const registeredCuttingOrders = dueCuttingOrders.filter((mo) => {
        const comps = componentsByMoId.get(mo.id) || [];
        const boardComps = comps.filter((c) => {
          const compName = Array.isArray(c.product_id) ? c.product_id[1] : '';
          return isBoardProductName(compName);
        });

        const soDate = saleOrderMap.get(mo.origin || '')?.date_order || mo.create_date;
        const soDay = soDate ? soDate.slice(0, 10) : '';

        if (!boardComps.length) {
          return physicalMoves.some((move) => {
            const moveDay = move.date ? move.date.slice(0, 10) : '';
            const pName = Array.isArray(move.product_id) ? move.product_id[1] : '';
            return moveDay >= soDay && isBoardProductName(pName) && isPhysicalInventoryMove(move, locationId);
          });
        }

        return boardComps.every((c) => {
          const required = c.product_uom_qty || 0;
          const reserved = c.quantity || 0;
          if (reserved >= required && required > 0) return true;

          const compName = Array.isArray(c.product_id) ? c.product_id[1] : '';
          return physicalMoves.some((move) => {
            const moveDay = move.date ? move.date.slice(0, 10) : '';
            const pName = Array.isArray(move.product_id) ? move.product_id[1] : '';
            return moveDay >= soDay && pName.toLowerCase() === compName.toLowerCase() && isPhysicalInventoryMove(move, locationId);
          });
        });
      });

      const expectedBoards = dueCuttingOrders.length;
      const registeredBoards = registeredCuttingOrders.length;
      const missingBoards = Math.max(0, expectedBoards - registeredBoards);
      const coveragePercent = expectedBoards > 0
        ? Math.min(100, Math.max(0, Math.round((registeredBoards / expectedBoards) * 100)))
        : 0;

      const details = `Period ${fromDate} to ${toDate} | Cutting MOs due on SO confirmation day: ${expectedBoards} | MOs with physical inventory logged same day: ${registeredBoards} | Missing same-day MO board entries: ${missingBoards} | Board purchase component found: ${boardPurchasesByOrigin.size} excluded | Edge banding excluded`;

      return {
        monthLabel,
        registeredBoards,
        expectedBoards,
        missingBoards,
        registeredMoves: registeredCuttingOrders.length,
        expectedMoves: dueCuttingOrders.length,
        coveragePercent,
        details,
      };
    } catch (err) {
      console.warn('[odooClient] Failed to fetch board registration summary:', err);
      return null;
    }
  }

  /**
   * Get the client name for a Sale Order by its name/number.
   */
  async getSaleOrderClient(soName: string): Promise<string | null> {
    const sos = await this.request<Array<{ partner_id: [number, string] }>>(
      'sale.order', 'search_read',
      { domain: [['name', '=', soName]], fields: ['partner_id'], limit: 1 },
    );
    return sos[0] && Array.isArray(sos[0].partner_id) ? sos[0].partner_id[1] : null;
  }

  private classifyWriteError(error: unknown): OdooWriteErrorType {
    if (error instanceof OdooClientError) {
      if (!error.statusCode) {
        return 'network_error';
      }

      if (error.statusCode === 401 || error.statusCode === 403) {
        return 'access_denied';
      }

      if (/access/i.test(error.message) && /denied|forbidden|not allowed/i.test(error.message)) {
        return 'access_denied';
      }

      if (/field/i.test(error.message) && /exist|unknown|invalid/i.test(error.message)) {
        return 'invalid_field';
      }

      return 'api_failure';
    }

    return 'network_error';
  }

  private async request<T>(
    model: string,
    method: string,
    payload: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ) {
    let attempt = 0;
    try {
      while (true) {
        const response = await axios.post<T | OdooErrorResponse>(
          `${this.json2BaseUrl}/${model}/${method}`,
          payload,
          {
            headers: this.buildHeaders(),
            timeout: options?.timeoutMs ?? this.timeoutMs,
            validateStatus: () => true,
          },
        );

        if (response.status >= 200 && response.status < 300) {
          return response.data as T;
        }

        if (response.status === 429 && attempt < this.maxRateLimitRetries) {
          const retryAfterSeconds = Number(response.headers?.['retry-after']);
          const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : this.rateLimitRetryBaseMs * 2 ** attempt;
          attempt += 1;
          await this.wait(retryAfterMs);
          continue;
        }

        throw new OdooClientError(
          this.extractErrorMessage(response.data, response.status),
          response.status,
          response.data,
        );
      }
    } catch (error) {
      if (error instanceof OdooClientError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        throw new OdooClientError(
          this.extractAxiosMessage(error, model, method),
          error.response?.status,
          {
            code: error.code,
            model,
            method,
          },
        );
      }

      throw error;
    }
  }

  private buildHeaders() {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `bearer ${this.credentials.apiKey}`,
      ...(this.credentials.database.trim()
        ? { 'X-Odoo-Database': this.credentials.database.trim() }
        : {}),
      'User-Agent': 'odoo-job-summary-extractor-node',
    };
  }

  private async authenticateWebSession(force = false) {
    const sharedSession = sharedOdooWebSessions.get(this.webSessionKey);
    if (!force && sharedSession?.authenticated) {
      this.webSessionCookie = sharedSession.cookie;
      this.webSessionContext = sharedSession.context;
      return;
    }
    if (!force && sharedSession?.awaitingOtp) {
      throw new OdooClientError(
        'Odoo is waiting for the two-factor authentication code. An administrator must verify it in Settings.',
        428,
      );
    }
    if (this.webSessionCookie && !force) {
      return;
    }

    const response = await axios.post<OdooJsonRpcResponse<{
      uid?: number;
      user_context?: Record<string, unknown>;
    }>>(
      `${this.baseUrl}/web/session/authenticate`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          db: this.credentials.database.trim(),
          login: this.credentials.username,
          password: this.credentials.shopFloorPassword || this.credentials.apiKey,
        },
        id: ++this.webRpcSequence,
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': 'odoo-job-summary-extractor-node',
        },
        timeout: this.timeoutMs,
        validateStatus: () => true,
      },
    );

    const responseCookie = this.mergeResponseCookies('', response.headers['set-cookie']);
    if (response.status < 200 || response.status >= 300 || response.data?.error) {
      const authenticationError = this.extractWebRpcError(
        response.data,
        response.status,
        'web session authentication',
      );
      if (responseCookie && /access denied|two-factor|authentication code|verification code|otp/i.test(authenticationError)) {
        this.webSessionCookie = responseCookie;
        this.webSessionContext = {};
        sharedOdooWebSessions.set(this.webSessionKey, {
          cookie: responseCookie,
          context: {},
          authenticated: false,
          awaitingOtp: true,
          updatedAt: Date.now(),
        });
        throw new OdooClientError(
          'Odoo accepted the account password and is waiting for its two-factor authentication code.',
          428,
          response.data,
        );
      }
      throw new OdooClientError(
        authenticationError,
        response.status,
        response.data,
      );
    }

    if (!response.data?.result?.uid) {
      if (responseCookie) {
        const sessionProbe = await axios.post<OdooJsonRpcResponse<{
          uid?: number;
          user_context?: Record<string, unknown>;
        }>>(
          `${this.baseUrl}/web/session/get_session_info`,
          { jsonrpc: '2.0', method: 'call', params: {}, id: ++this.webRpcSequence },
          {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Cookie: responseCookie,
              'User-Agent': 'odoo-job-summary-extractor-node',
            },
            timeout: this.timeoutMs,
            validateStatus: () => true,
          },
        );
        if (
          sessionProbe.status >= 200 &&
          sessionProbe.status < 300 &&
          !sessionProbe.data?.error &&
          sessionProbe.data?.result?.uid
        ) {
          const authenticatedCookie = this.mergeResponseCookies(
            responseCookie,
            sessionProbe.headers['set-cookie'],
          );
          const context = sessionProbe.data.result.user_context || {};
          this.webSessionCookie = authenticatedCookie;
          this.webSessionContext = context;
          sharedOdooWebSessions.set(this.webSessionKey, {
            cookie: authenticatedCookie,
            context,
            authenticated: true,
            awaitingOtp: false,
            updatedAt: Date.now(),
          });
          return;
        }

        this.webSessionCookie = responseCookie;
        this.webSessionContext = {};
        sharedOdooWebSessions.set(this.webSessionKey, {
          cookie: responseCookie,
          context: {},
          authenticated: false,
          awaitingOtp: true,
          updatedAt: Date.now(),
        });
        throw new OdooClientError(
          'Odoo accepted the account password and is waiting for its two-factor authentication code.',
          428,
          response.data,
        );
      }
      throw new OdooClientError(
        'The configured Odoo account could not open an authenticated Shop Floor session. Save its normal Odoo web password in Settings.',
        401,
        response.data,
      );
    }

    const sessionCookie = responseCookie;
    if (!sessionCookie) {
      throw new OdooClientError(
        'Odoo authenticated the account but did not return a Shop Floor session cookie.',
        502,
      );
    }

    this.webSessionCookie = sessionCookie;
    this.webSessionContext = response.data.result.user_context || {};
    sharedOdooWebSessions.set(this.webSessionKey, {
      cookie: sessionCookie,
      context: this.webSessionContext,
      authenticated: true,
      awaitingOtp: false,
      updatedAt: Date.now(),
    });
  }

  async beginShopFloorSession(): Promise<{ connected: boolean; requiresOtp: boolean }> {
    sharedOdooWebSessions.delete(this.webSessionKey);
    this.webSessionCookie = null;
    this.webSessionContext = {};

    const loginPage = await axios.get<string>(
      `${this.baseUrl}/web/login`,
      {
        params: { db: this.credentials.database.trim(), redirect: '/web' },
        headers: { 'User-Agent': 'odoo-job-summary-extractor-node' },
        timeout: this.timeoutMs,
        maxRedirects: 0,
        responseType: 'text',
        validateStatus: () => true,
      },
    );
    if (loginPage.status < 200 || loginPage.status >= 400) {
      throw new OdooClientError(
        `Could not open the Odoo login page (${loginPage.status}).`,
        loginPage.status,
      );
    }
    const initialCookie = this.mergeResponseCookies('', loginPage.headers['set-cookie']);
    const csrfToken =
      loginPage.data.match(/name=["']csrf_token["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
      loginPage.data.match(/value=["']([^"']+)["'][^>]*name=["']csrf_token["']/i)?.[1];
    if (!initialCookie || !csrfToken) {
      throw new OdooClientError('Odoo did not provide a valid web-login session.', 502);
    }

    const loginBody = new URLSearchParams({
      csrf_token: csrfToken,
      db: this.credentials.database.trim(),
      login: this.credentials.username,
      password: this.credentials.shopFloorPassword || '',
      redirect: '/web',
    }).toString();
    const loginResponse = await axios.post<string>(
      `${this.baseUrl}/web/login`,
      loginBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: initialCookie,
          'User-Agent': 'odoo-job-summary-extractor-node',
        },
        timeout: this.timeoutMs,
        maxRedirects: 0,
        responseType: 'text',
        validateStatus: () => true,
      },
    );
    const loginCookie = this.mergeResponseCookies(
      initialCookie,
      loginResponse.headers['set-cookie'],
    );
    const location = String(loginResponse.headers.location || '');

    if (/\/web\/login\/totp/i.test(location)) {
      const otpPage = await axios.get<string>(
        new URL(location, this.baseUrl).toString(),
        {
          headers: {
            Cookie: loginCookie,
            'User-Agent': 'odoo-job-summary-extractor-node',
          },
          timeout: this.timeoutMs,
          maxRedirects: 0,
          responseType: 'text',
          validateStatus: () => true,
        },
      );
      const otpCookie = this.mergeResponseCookies(loginCookie, otpPage.headers['set-cookie']);
      const otpCsrfToken =
        otpPage.data.match(/name=["']csrf_token["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
        otpPage.data.match(/value=["']([^"']+)["'][^>]*name=["']csrf_token["']/i)?.[1];
      sharedOdooWebSessions.set(this.webSessionKey, {
        cookie: otpCookie,
        context: {},
        authenticated: false,
        awaitingOtp: true,
        csrfToken: otpCsrfToken,
        updatedAt: Date.now(),
      });
      this.webSessionCookie = otpCookie;
      return { connected: false, requiresOtp: true };
    }

    const sessionInfoResponse = await axios.post<OdooJsonRpcResponse<{
      uid?: number;
      user_context?: Record<string, unknown>;
    }>>(
      `${this.baseUrl}/web/session/get_session_info`,
      { jsonrpc: '2.0', method: 'call', params: {}, id: ++this.webRpcSequence },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Cookie: loginCookie,
          'User-Agent': 'odoo-job-summary-extractor-node',
        },
        timeout: this.timeoutMs,
        validateStatus: () => true,
      },
    );
    if (
      sessionInfoResponse.status < 200 ||
      sessionInfoResponse.status >= 300 ||
      sessionInfoResponse.data?.error ||
      !sessionInfoResponse.data?.result?.uid
    ) {
      throw new OdooClientError(
        'Odoo did not accept the configured username and web password.',
        401,
        sessionInfoResponse.data,
      );
    }
    const finalCookie = this.mergeResponseCookies(
      loginCookie,
      sessionInfoResponse.headers['set-cookie'],
    );
    const context = sessionInfoResponse.data.result.user_context || {};
    this.webSessionCookie = finalCookie;
    this.webSessionContext = context;
    sharedOdooWebSessions.set(this.webSessionKey, {
      cookie: finalCookie,
      context,
      authenticated: true,
      awaitingOtp: false,
      updatedAt: Date.now(),
    });
    return { connected: true, requiresOtp: false };
  }

  async verifyShopFloorOtp(code: string): Promise<{ connected: true }> {
    const normalizedCode = code.replace(/\s+/g, '');
    if (!/^\d{4,10}$/.test(normalizedCode)) {
      throw new OdooClientError('Enter the numeric authentication code sent by Odoo.', 400);
    }
    const pendingSession = sharedOdooWebSessions.get(this.webSessionKey);
    if (!pendingSession?.awaitingOtp || !pendingSession.cookie) {
      throw new OdooClientError(
        'No Odoo authentication code is currently pending. Request a new code first.',
        409,
      );
    }

    const formBody = new URLSearchParams({
      ...(pendingSession.csrfToken ? { csrf_token: pendingSession.csrfToken } : {}),
      totp_token: normalizedCode,
      redirect: '/web',
      remember: '1',
    }).toString();
    const response = await axios.post(
      `${this.baseUrl}/web/login/totp`,
      formBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: pendingSession.cookie,
          'User-Agent': 'odoo-job-summary-extractor-node',
        },
        maxRedirects: 0,
        timeout: this.timeoutMs,
        responseType: 'text',
        validateStatus: () => true,
      },
    );
    const cookie = this.mergeResponseCookies(
      pendingSession.cookie,
      response.headers['set-cookie'],
    );

    const sessionInfoResponse = await axios.post<OdooJsonRpcResponse<{
      uid?: number;
      user_context?: Record<string, unknown>;
    }>>(
      `${this.baseUrl}/web/session/get_session_info`,
      { jsonrpc: '2.0', method: 'call', params: {}, id: ++this.webRpcSequence },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Cookie: cookie,
          'User-Agent': 'odoo-job-summary-extractor-node',
        },
        timeout: this.timeoutMs,
        validateStatus: () => true,
      },
    );
    if (
      sessionInfoResponse.status < 200 ||
      sessionInfoResponse.status >= 300 ||
      sessionInfoResponse.data?.error ||
      !sessionInfoResponse.data?.result?.uid
    ) {
      throw new OdooClientError(
        'Odoo did not accept that authentication code. Request a new code or enter the latest code received.',
        401,
        sessionInfoResponse.data,
      );
    }

    const finalCookie = this.mergeResponseCookies(
      cookie,
      sessionInfoResponse.headers['set-cookie'],
    );
    const context = sessionInfoResponse.data.result.user_context || {};
    this.webSessionCookie = finalCookie;
    this.webSessionContext = context;
    sharedOdooWebSessions.set(this.webSessionKey, {
      cookie: finalCookie,
      context,
      authenticated: true,
      awaitingOtp: false,
      updatedAt: Date.now(),
    });
    return { connected: true };
  }

  private mergeResponseCookies(
    existingCookie: string,
    setCookieHeaders: string[] | undefined,
  ) {
    const cookies = new Map<string, string>();
    for (const part of existingCookie.split(/;\s*/).filter(Boolean)) {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex > 0) {
        cookies.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
      }
    }
    for (const header of setCookieHeaders || []) {
      const cookiePart = header.split(';', 1)[0];
      const separatorIndex = cookiePart.indexOf('=');
      if (separatorIndex > 0) {
        cookies.set(cookiePart.slice(0, separatorIndex), cookiePart.slice(separatorIndex + 1));
      }
    }
    return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private async callNativeShopFloorMethod<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {},
    retrySession = true,
  ): Promise<T> {
    await this.authenticateWebSession();
    const context = {
      ...this.webSessionContext,
      ...(
        kwargs.context && typeof kwargs.context === 'object'
          ? kwargs.context as Record<string, unknown>
          : {}
      ),
    };
    const response = await axios.post<OdooJsonRpcResponse<T>>(
      `${this.baseUrl}/web/dataset/call_kw/${encodeURIComponent(model)}/${encodeURIComponent(method)}`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model,
          method,
          args,
          kwargs: {
            ...kwargs,
            context,
          },
        },
        id: ++this.webRpcSequence,
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Cookie: this.webSessionCookie || '',
          'User-Agent': 'odoo-job-summary-extractor-node',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: this.timeoutMs,
        validateStatus: () => true,
      },
    );

    const sessionExpired =
      response.status === 401 ||
      /session.*expired|not authenticated/i.test(this.extractWebRpcError(response.data, response.status, method));
    if (sessionExpired && retrySession) {
      sharedOdooWebSessions.delete(this.webSessionKey);
      this.webSessionCookie = null;
      this.webSessionContext = {};
      await this.authenticateWebSession(true);
      return this.callNativeShopFloorMethod<T>(model, method, args, kwargs, false);
    }

    if (response.status < 200 || response.status >= 300 || response.data?.error) {
      throw new OdooClientError(
        this.extractWebRpcError(response.data, response.status, `${model}.${method}`),
        response.status,
        response.data,
      );
    }
    return response.data.result as T;
  }

  private extractWebRpcError(
    payload: OdooJsonRpcResponse<unknown> | undefined,
    status: number,
    operation: string,
  ) {
    const error = payload?.error;
    const details = error?.data?.message || error?.message;
    return details
      ? `Odoo ${operation} failed: ${details}`
      : `Odoo ${operation} failed (${status}).`;
  }

  /**
   * Fetch team penalty metrics: unmarked deliveries and undone receipts.
   */
  async getTeamPenalties(stockScope?: { warehouseId?: string; pickingTypeId?: string }): Promise<{ unmarkedDeliveries: number; undoneReceipts: number }> {
    try {
      const scopedWarehouseId = Number(stockScope?.warehouseId || 0);
      if (scopedWarehouseId > 0) {
        const warehouse = await this.getVerifiedTargetWarehouse(scopedWarehouseId);
        const scopedPickings = await this.searchReadRecords<{ name: string; picking_type_code: string }>('stock.picking', {
          domain: [['company_id', '=', warehouse.companyId], ['picking_type_id.warehouse_id', '=', warehouse.id], ['state', 'in', ['waiting', 'confirmed', 'assigned']]],
          fields: ['name', 'picking_type_code'],
          limit: 2000,
        });
        return {
          unmarkedDeliveries: scopedPickings.filter((p) => p.picking_type_code === 'outgoing' && String(p.name || '').toUpperCase().startsWith(`${warehouse.code}/OUT/`)).length,
          undoneReceipts: scopedPickings.filter((p) => p.picking_type_code === 'incoming' && String(p.name || '').toUpperCase().startsWith(`${warehouse.code}/IN/`)).length,
        };
      }

      const pickings = await this.request<Array<{ picking_type_code: string; state: string }>>(
        'stock.picking',
        'search_read',
        {
          domain: [['state', 'not in', ['done', 'cancel']]],
          fields: ['picking_type_code', 'state'],
        }
      );

      let unmarkedDeliveries = 0;
      let undoneReceipts = 0;

      for (const p of pickings) {
        if (p.picking_type_code === 'outgoing') unmarkedDeliveries++;
      }

      const pickingTypeId = String(stockScope?.pickingTypeId || '').trim();
      if (pickingTypeId) {
        const receiptCounters = await this.request<Array<{ count_picking: number }>>(
          'stock.picking.type',
          'search_read',
          {
            domain: [['id', '=', Number(pickingTypeId)]],
            fields: ['count_picking'],
            limit: 1,
          },
        );

        undoneReceipts = Number(receiptCounters[0]?.count_picking || 0);
      } else if (String(stockScope?.warehouseId || '').trim()) {
        const warehouseId = Number(stockScope?.warehouseId || 0);
        if (warehouseId > 0) {
          const warehouses = await this.request<Array<{ in_type_id: [number, string] | false }>>(
            'stock.warehouse',
            'search_read',
            {
              domain: [['id', '=', warehouseId]],
              fields: ['in_type_id'],
              limit: 1,
            },
          );
          const inTypeId = Array.isArray(warehouses[0]?.in_type_id) ? warehouses[0].in_type_id[0] : null;
          if (inTypeId) {
            const receiptCounters = await this.request<Array<{ count_picking: number }>>(
              'stock.picking.type',
              'search_read',
              {
                domain: [['id', '=', inTypeId]],
                fields: ['count_picking'],
                limit: 1,
              },
            );
            undoneReceipts = Number(receiptCounters[0]?.count_picking || 0);
          } else {
            undoneReceipts = pickings.filter((p) => p.picking_type_code === 'incoming').length;
          }
        }
      } else {
        undoneReceipts = pickings.filter((p) => p.picking_type_code === 'incoming').length;
      }

      return { unmarkedDeliveries, undoneReceipts };
    } catch {
      return { unmarkedDeliveries: 0, undoneReceipts: 0 };
    }
  }

  private extractErrorMessage(data: unknown, status: number): string {
    if (data && typeof data === 'object') {
      const payload = data as OdooErrorResponse;
      if (payload.message) {
        return payload.message;
      }
      if (payload.name) {
        return `${payload.name} (${status})`;
      }
    }

    return `Odoo API request failed with status ${status}.`;
  }

  private extractAxiosMessage(error: AxiosError, model: string, method: string): string {
    if (error.response) {
      return `Odoo API request failed with status ${error.response.status} while calling ${model}/${method}.`;
    }

    if (error.code === 'ECONNABORTED') {
      return `Odoo request timed out while calling ${model}/${method}.`;
    }

    return error.message;
  }

  /**
   * Get all active maintenance equipment from Odoo.
   */
  async getMaintenanceEquipment(): Promise<Array<{ id: number; name: string }>> {
    return this.searchReadRecords<{ id: number; name: string }>('maintenance.equipment', {
      domain: [],
      fields: ['id', 'name', 'state'],
      order: 'name asc',
    });
  }

  /**
   * Get maintenance requests from Odoo.
   */
  async getMaintenanceRequests(limit = 50): Promise<any[]> {
    return this.searchReadRecords<any>('maintenance.request', {
      domain: [],
      fields: [
        'id',
        'name',
        'description',
        'employee_id',
        'request_date',
        'close_date',
        'stage_id',
        'priority',
      ],
      limit,
      order: 'request_date desc, id desc',
    });
  }

  /**
   * Create a new maintenance request in Odoo.
   */
  async createMaintenanceRequest(input: {
    equipmentId: number | null;
    machineName: string;
    description: string;
    employeeId: number | null;
    priority: string;
  }): Promise<number> {
    return this.createRecord('maintenance.request', {
      name: `Breakdown: ${input.machineName}`,
      description: input.description,
      equipment_id: input.equipmentId || false,
      employee_id: input.employeeId || false,
      maintenance_type: 'corrective',
      priority: input.priority,
      request_date: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Resolve a maintenance request in Odoo by setting stage to 'Repaired'.
   */
  async resolveMaintenanceRequest(id: number): Promise<boolean> {
    const stages = await this.searchReadRecords<{ id: number; name: string }>('maintenance.stage', {
      domain: [['name', '=', 'Repaired']],
      fields: ['id'],
      limit: 1,
    });
    const stageId = stages && stages.length > 0 ? stages[0].id : 3;
    return this.writeRecord('maintenance.request', [id], {
      stage_id: stageId,
      close_date: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Get active equipment assigned to an employee in Odoo.
   */
  async getEmployeeAssignedEquipment(employeeId: number): Promise<Array<{ id: number; name: string; assign_date: string | null; serial_no: string | null }>> {
    return this.searchReadRecords<any>('maintenance.equipment', {
      domain: [['employee_id', '=', employeeId]],
      fields: ['id', 'name', 'assign_date', 'serial_no'],
      order: 'assign_date desc, name asc',
    });
  }

  /**
   * Get all active equipments assigned to any employee in Odoo.
   */
  async getBulkAssignedEquipment(): Promise<Array<{ id: number; name: string; employee_id: [number, string]; assign_date: string | null }>> {
    return this.searchReadRecords<any>('maintenance.equipment', {
      domain: [['employee_id', '!=', false]],
      fields: ['id', 'name', 'employee_id', 'assign_date'],
      limit: 2000,
    });
  }

  /**
   * Assign an equipment by name to an employee identified by email.
   * If the equipment does not exist in Odoo, it creates one.
   */
  async assignEquipmentToEmployee(email: string, itemName: string, assignDate: string): Promise<boolean> {
    try {
      const employee = await this.findEmployeeByWorkEmail(email);
      if (!employee) {
        throw new Error(`Employee with email ${email} not found in Odoo.`);
      }

      // Search for equipment by name
      const equipments = await this.searchReadRecords<{ id: number }>('maintenance.equipment', {
        domain: [['name', '=', itemName]],
        fields: ['id'],
        limit: 1,
      });

      let equipmentId: number;
      if (equipments && equipments.length > 0) {
        equipmentId = equipments[0].id;
      } else {
        // Create new equipment
        equipmentId = await this.createRecord('maintenance.equipment', {
          name: itemName,
        });
      }

      // Assign to employee
      await this.writeRecord('maintenance.equipment', [equipmentId], {
        employee_id: employee.id,
        assign_date: assignDate,
      });
      return true;
    } catch (err) {
      console.error('[OdooClient] Failed to assign equipment to employee:', err);
      throw err;
    }
  }

  async getBoardProducts(warehouseId?: number): Promise<Array<{
    id: number; name: string; qty_available: number; free_qty: number;
    virtual_available: number; incoming_qty: number; outgoing_qty: number;
  }>> {
    let categoryId: number | null = null;
    try {
      const categories = await this.searchReadRecords<{ id: number }>('product.category', {
        domain: [['complete_name', '=', 'Goods / Boards']],
        fields: ['id'],
        limit: 1,
      });
      if (categories && categories.length > 0) {
        categoryId = categories[0].id;
      }
    } catch (err) {
      console.warn('[OdooClient] Failed to fetch product category for boards:', err);
    }

    if (categoryId === null) {
      throw new Error('The Odoo product category "Goods / Boards" could not be found.');
    }

    // Board Logging must only offer products in Goods / Boards (including its
    // child categories). Name-based fallbacks can leak unrelated products into
    // the picker, so keep this domain deliberately strict.
    const domain: any[] = [
      ['active', '=', true],
      ['type', 'in', ['product', 'consu']],
      ['categ_id', 'child_of', categoryId],
      ['name', 'not ilike', 'Cutting%'],
    ];

    const products = await this.searchReadRecords<any>('product.product', {
      domain,
      fields: ['id', 'name', 'qty_available', 'free_qty', 'virtual_available', 'incoming_qty', 'outgoing_qty'],
      limit: 1000,
      order: 'name asc',
      context: warehouseId && warehouseId > 0 ? { warehouse: warehouseId } : undefined,
    });
    return products.map(p => ({
      id: p.id,
      name: p.name,
      qty_available: Number(p.qty_available || 0),
      free_qty: Number(p.free_qty ?? p.qty_available ?? 0),
      virtual_available: Number(p.virtual_available ?? p.qty_available ?? 0),
      incoming_qty: Number(p.incoming_qty || 0),
      outgoing_qty: Number(p.outgoing_qty || 0),
    }));
  }

  /**
   * Get active customers from Odoo.
   */
  async getOdooCustomers(limit = 500): Promise<Array<{ id: number; name: string }>> {
    return this.searchPartners('', limit);
  }

  /**
   * Search partner records from Odoo using the broadest practical match set.
   * This keeps board intake usable even when the desired client is not in the
   * first active-customer page or when Odoo stores the client as a contact,
   * company, or archived partner record.
   */
  async searchPartners(searchTerm: string, limit = 500): Promise<Array<{
    id: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    ref?: string | null;
    active?: boolean | null;
  }>> {
    const trimmed = String(searchTerm || '').trim();
    const domain: unknown[] = [];

    if (trimmed) {
      domain.push(
        '|',
        '|',
        '|',
        ['name', 'ilike', trimmed],
        ['email', 'ilike', trimmed],
        ['phone', 'ilike', trimmed],
        ['ref', 'ilike', trimmed],
      );
    }

    return this.searchReadRecords<{
      id: number;
      name: string;
      email?: string | null;
      phone?: string | null;
      ref?: string | null;
      active?: boolean | null;
    }>('res.partner', {
      domain,
      fields: ['id', 'name', 'email', 'phone', 'ref', 'active'],
      limit,
      order: 'name asc',
    });
  }

  async getPartnerById(partnerId: number): Promise<{ id: number; name: string } | null> {
    if (!Number.isFinite(partnerId) || partnerId <= 0) {
      return null;
    }

    const partners = await this.readRecords<{ id: number; name: string }>('res.partner', [partnerId], ['id', 'name']);
    return partners[0] || null;
  }

  /**
   * Get active board reservations from Odoo (represented as draft/waiting internal transfers).
   */
  async getActiveBoardReservations(): Promise<any[]> {
    try {
      const pickings = await this.searchReadRecords<any>('stock.picking', {
        domain: [
          ['state', 'in', ['draft', 'waiting', 'confirmed', 'assigned']],
          ['picking_type_code', '=', 'internal']
        ],
        fields: ['id', 'name', 'partner_id', 'origin', 'state', 'location_id', 'location_dest_id', 'scheduled_date'],
        limit: 100,
        order: 'scheduled_date desc, id desc',
      });

      if (!pickings || pickings.length === 0) return [];
      const pickingIds = pickings.map(p => p.id);

      const moves = await this.searchReadRecords<any>('stock.move', {
        domain: [['picking_id', 'in', pickingIds]],
        fields: ['id', 'picking_id', 'product_id', 'product_uom_qty'],
        limit: 1000,
      });

      const movesMap = new Map<number, any[]>();
      for (const m of moves) {
        if (!m.picking_id) continue;
        const pId = Array.isArray(m.picking_id) ? m.picking_id[0] : m.picking_id;
        if (!movesMap.has(pId)) movesMap.set(pId, []);
        movesMap.get(pId)!.push({
          productId: Array.isArray(m.product_id) ? m.product_id[0] : m.product_id,
          productName: Array.isArray(m.product_id) ? m.product_id[1] : '',
          quantity: Number(m.product_uom_qty || 0),
        });
      }

      return pickings.map(p => ({
        id: p.id,
        name: p.name,
        client: Array.isArray(p.partner_id) ? p.partner_id[1] : 'No Client',
        clientId: Array.isArray(p.partner_id) ? p.partner_id[0] : null,
        origin: p.origin || 'Direct Reservation',
        state: p.state,
        scheduledDate: p.scheduled_date,
        items: movesMap.get(p.id) || [],
      }));
    } catch (err) {
      console.error('[OdooClient] Failed to fetch active board reservations:', err);
      return [];
    }
  }

  /**
   * Get the main warehouse stock location ID (e.g. WH/Stock).
   * Finds the lot_stock_id from stock.warehouse for the target company.
   */
  async getMainWarehouseLocationId(): Promise<number> {
    const targetCompanyId = await this.getTargetCompanyId();
    const warehouses = await this.searchReadRecords<{
      id: number;
      lot_stock_id: [number, string] | false;
    }>('stock.warehouse', {
      domain: [['company_id', '=', targetCompanyId]],
      fields: ['id', 'lot_stock_id'],
      limit: 1,
      order: 'id asc',
    });

    if (warehouses.length > 0 && warehouses[0].lot_stock_id) {
      return warehouses[0].lot_stock_id[0];
    }

    // Fallback: find first internal location
    const locations = await this.searchReadRecords<{ id: number }>('stock.location', {
      domain: [['usage', '=', 'internal']],
      fields: ['id'],
      limit: 1,
    });
    if (!locations.length) throw new OdooClientError('No stock location found in Odoo.');
    return locations[0].id;
  }

  async ensureBoardProductIsStockable(productId: number): Promise<{
    changed: boolean;
    productName: string;
    templateId: number;
  }> {
    const variants = await this.request<Array<{
      id: number;
      display_name?: string;
      product_tmpl_id?: [number, string] | false;
    }>>('product.product', 'read', {
      ids: [productId],
      fields: ['id', 'display_name', 'product_tmpl_id'],
    });
    const variant = variants[0];
    const templateId = Array.isArray(variant?.product_tmpl_id) ? Number(variant.product_tmpl_id[0]) : 0;
    const productName = String(variant?.display_name || `Product ${productId}`);
    if (!variant || !templateId) {
      throw new OdooClientError(`Odoo board product ${productId} was not found or has no product template.`);
    }

    const availableFields = await this.request<Record<string, unknown>>('product.template', 'fields_get', {
      attributes: ['type', 'readonly'],
    });
    const fields = ['id', 'name'];
    if (availableFields.is_storable) fields.push('is_storable');
    if (availableFields.detailed_type) fields.push('detailed_type');
    if (availableFields.type) fields.push('type');
    const templates = await this.request<Array<Record<string, unknown>>>('product.template', 'read', {
      ids: [templateId],
      fields,
    });
    const template = templates[0];
    if (!template) throw new OdooClientError(`Odoo product template ${templateId} was not found.`);

    const alreadyStockable =
      template.is_storable === true ||
      template.detailed_type === 'product' ||
      template.type === 'product';
    if (alreadyStockable) return { changed: false, productName, templateId };

    if (availableFields.is_storable) {
      await this.writeRecord('product.template', [templateId], { is_storable: true });
    } else if (availableFields.detailed_type) {
      await this.writeRecord('product.template', [templateId], { detailed_type: 'product' });
    } else if (availableFields.type) {
      await this.writeRecord('product.template', [templateId], { type: 'product' });
    } else {
      throw new OdooClientError(
        `${productName} is a consumable and this Odoo version exposes no writable stockable-product field.`,
      );
    }

    return { changed: true, productName, templateId };
  }

  /**
   * Add boards to stock at the main warehouse location.
   * Increments current quantity by the given amount via inventory adjustment.
   */
  async addBoardsToStock(input: {
    productId: number;
    quantity: number;
    locationId?: number;
  }): Promise<{ locationId: number; previousQty: number; newQty: number }> {
    const locationId = input.locationId || await this.getMainWarehouseLocationId();
    const quants = await this.getStockQuants(input.productId, locationId);

    let quantId: number;
    let previousQty = 0;

    if (quants.length > 0) {
      quantId = quants[0].id;
      previousQty = Number(quants[0].quantity || 0);
      await this.writeRecord('stock.quant', [quantId], {
        inventory_quantity: previousQty + input.quantity,
      });
    } else {
      quantId = await this.createRecord('stock.quant', {
        product_id: input.productId,
        location_id: locationId,
        inventory_quantity: input.quantity,
      });
    }

    await this.callRecordMethod('stock.quant', 'action_apply_inventory', [quantId]);

    return {
      locationId,
      previousQty,
      newQty: previousQty + input.quantity,
    };
  }

  /** Reverse a board-intake inventory adjustment at the same warehouse location. */
  async removeBoardsFromStock(input: {
    productId: number;
    quantity: number;
    locationId?: number;
  }): Promise<{ locationId: number; previousQty: number; newQty: number }> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new OdooClientError('The revert quantity must be positive.');
    }
    const locationId = input.locationId || await this.getMainWarehouseLocationId();
    const quants = await this.getStockQuants(input.productId, locationId);
    if (!quants.length) throw new OdooClientError('No Odoo stock record exists for this board, so the intake cannot be reverted.');
    const quantId = quants[0].id;
    const previousQty = Number(quants[0].quantity || 0);
    const newQty = previousQty - input.quantity;
    if (newQty < -0.0001) {
      throw new OdooClientError(`Odoo currently has ${previousQty} board(s), but this log requires reverting ${input.quantity}. The stock may already have been used.`);
    }
    await this.writeRecord('stock.quant', [quantId], { inventory_quantity: Math.max(0, newQty) });
    await this.callRecordMethod('stock.quant', 'action_apply_inventory', [quantId]);
    return { locationId, previousQty, newQty: Math.max(0, newQty) };
  }

  private async getVerifiedTargetWarehouse(warehouseId: number) {
    const targetCompanyId = await this.getTargetCompanyId();
    const warehouses = await this.searchReadRecords<{ id: number; name: string; code: string }>('stock.warehouse', {
      domain: [['id', '=', warehouseId], ['company_id', '=', targetCompanyId]],
      fields: ['id', 'name', 'code'],
      limit: 1,
    });
    if (!warehouses.length) throw new OdooClientError(`Configured warehouse ${warehouseId} does not belong to ${env.ODOO_TARGET_COMPANY_NAME}.`);
    const code = String(warehouses[0].code || '').trim().toUpperCase();
    if (!code) throw new OdooClientError(`Configured warehouse ${warehouseId} has no Odoo warehouse code.`);
    return { ...warehouses[0], code, companyId: targetCompanyId };
  }

  async getOpenBoardReceipts(warehouseId: number) {
    const warehouse = await this.getVerifiedTargetWarehouse(warehouseId);
    const pickings = await this.searchReadRecords<any>('stock.picking', {
      domain: [['company_id', '=', warehouse.companyId], ['picking_type_id.warehouse_id', '=', warehouse.id], ['picking_type_code', '=', 'incoming'], ['state', 'in', ['waiting', 'confirmed', 'assigned']]],
      fields: ['id', 'name', 'partner_id', 'origin', 'state', 'scheduled_date'],
      limit: 200,
      order: 'scheduled_date asc, id asc',
    });
    const scopedPickings = pickings.filter((p) => String(p.name || '').toUpperCase().startsWith(`${warehouse.code}/IN/`));
    if (!scopedPickings.length) return [];
    const moves = await this.searchReadRecords<any>('stock.move', {
      domain: [['picking_id', 'in', scopedPickings.map((p) => p.id)], ['state', 'not in', ['done', 'cancel']]],
      fields: ['picking_id', 'product_id', 'product_uom_qty', 'quantity'],
      limit: 2000,
    });
    const byPicking = new Map<number, any[]>();
    moves.forEach((move) => {
      const id = Array.isArray(move.picking_id) ? move.picking_id[0] : move.picking_id;
      const name = Array.isArray(move.product_id) ? String(move.product_id[1] || '') : '';
      if (!byPicking.has(id)) byPicking.set(id, []);
      byPicking.get(id)!.push({ name, ordered: Number(move.product_uom_qty || 0), received: Number(move.quantity || 0) });
    });
    return scopedPickings.map((p) => ({ ...p, items: byPicking.get(p.id) || [] }));
  }

  private async assertPickingBelongsToWarehouse(pickingId: number, warehouseId: number, operation: 'incoming' | 'outgoing') {
    const warehouse = await this.getVerifiedTargetWarehouse(warehouseId);
    const records = await this.searchReadRecords<any>('stock.picking', {
      domain: [['id', '=', pickingId], ['company_id', '=', warehouse.companyId], ['picking_type_id.warehouse_id', '=', warehouse.id], ['picking_type_code', '=', operation]],
      fields: ['id', 'name'],
      limit: 1,
    });
    const expectedSegment = operation === 'incoming' ? 'IN' : 'OUT';
    const expectedPrefix = `${warehouse.code}/${expectedSegment}/`;
    if (!records.length || !String(records[0].name || '').toUpperCase().startsWith(expectedPrefix)) {
      throw new OdooClientError(`This ${operation === 'incoming' ? 'receipt' : 'delivery'} does not belong to the configured Urban Vibe warehouse.`);
    }
    return records[0] as { id: number; name: string; state: string };
  }

  private async getOperatorOnlineFieldName(model: string): Promise<string | null> {
    try {
      const fields = await this.searchReadRecords<{ name: string; field_description?: string }>('ir.model.fields', {
        domain: [
          ['model', '=', model],
          '|',
          ['field_description', 'ilike', 'Operator'],
          ['name', 'ilike', 'operator'],
        ],
        fields: ['name', 'field_description'],
        limit: 20,
      });
      const exact = fields.find((f) => String(f.field_description || '').trim().toLowerCase() === 'operator online');
      if (exact) return exact.name;
      const exactName = fields.find((f) => f.name === 'x_operator_online' || f.name === 'x_studio_operator_online');
      if (exactName) return exactName.name;
      const matchDesc = fields.find((f) => String(f.field_description || '').toLowerCase().includes('operator'));
      if (matchDesc) return matchDesc.name;
      const matchName = fields.find((f) => f.name.includes('operator'));
      if (matchName) return matchName.name;
      return null;
    } catch {
      return null;
    }
  }

  private async getValidationDatetimeFieldName(model: string): Promise<string | null> {
    try {
      const fields = await this.searchReadRecords<{ name: string; field_description?: string }>('ir.model.fields', {
        domain: [
          ['model', '=', model],
          '|',
          ['field_description', 'ilike', 'Validation'],
          ['name', 'ilike', 'validation'],
        ],
        fields: ['name', 'field_description'],
        limit: 20,
      });
      const exact = fields.find((f) => String(f.field_description || '').trim().toLowerCase() === 'validation datetime');
      if (exact) return exact.name;
      const exactName = fields.find((f) => f.name === 'x_validation_datetime' || f.name === 'x_studio_validation_datetime');
      if (exactName) return exactName.name;
      const matchDesc = fields.find((f) => String(f.field_description || '').toLowerCase().includes('validation'));
      if (matchDesc) return matchDesc.name;
      const matchName = fields.find((f) => f.name.includes('validation'));
      if (matchName) return matchName.name;
      return null;
    } catch {
      return null;
    }
  }

  async populatePickingValidationMetadata(pickingId: number, actorEmail: string): Promise<void> {
    try {
      const pickings = await this.searchReadRecords<any>('stock.picking', {
        domain: [['id', '=', pickingId]],
        fields: ['id', 'partner_id', 'owner_id', 'origin', 'purchase_id'],
        limit: 1,
      });
      if (!pickings.length) return;
      const picking = pickings[0];
      const partnerId = Array.isArray(picking.partner_id)
        ? Number(picking.partner_id[0])
        : Number(picking.partner_id || 0);

      const ownerId = partnerId > 0 ? partnerId : undefined;

      const rawOrigin = String(picking.origin || '').trim();
      const purchasePoName = Array.isArray(picking.purchase_id)
        ? String(picking.purchase_id[1] || '').trim()
        : '';
      const sourceDoc = rawOrigin || purchasePoName || undefined;
      const nowFormatted = new Date().toISOString().replace('T', ' ').substring(0, 19);

      const [moves, moveLines, operatorPickingField, operatorMoveField, operatorLineField, valDtPickingField, valDtMoveField, valDtLineField] = await Promise.all([
        this.searchReadRecords<any>('stock.move', {
          domain: [['picking_id', '=', pickingId]],
          fields: ['id'],
          limit: 1000,
        }),
        this.searchReadRecords<any>('stock.move.line', {
          domain: [['picking_id', '=', pickingId]],
          fields: ['id'],
          limit: 1000,
        }),
        this.getOperatorOnlineFieldName('stock.picking'),
        this.getOperatorOnlineFieldName('stock.move'),
        this.getOperatorOnlineFieldName('stock.move.line'),
        this.getValidationDatetimeFieldName('stock.picking'),
        this.getValidationDatetimeFieldName('stock.move'),
        this.getValidationDatetimeFieldName('stock.move.line'),
      ]);

      const moveIds = moves.map((m) => Number(m.id)).filter((id) => id > 0);
      const moveLineIds = moveLines.map((ml) => Number(ml.id)).filter((id) => id > 0);

      if (ownerId) {
        const updateOwnerVals = { owner_id: ownerId };
        await Promise.all([
          this.writeRecord('stock.picking', [pickingId], updateOwnerVals).catch(() => null),
          moveIds.length ? this.writeRecord('stock.move', moveIds, updateOwnerVals).catch(() => null) : null,
          moveLineIds.length ? this.writeRecord('stock.move.line', moveLineIds, updateOwnerVals).catch(() => null) : null,
        ]);
      }

      if (sourceDoc) {
        const updateOriginVals = { origin: sourceDoc };
        await Promise.all([
          this.writeRecord('stock.picking', [pickingId], updateOriginVals).catch(() => null),
          moveIds.length ? this.writeRecord('stock.move', moveIds, updateOriginVals).catch(() => null) : null,
          moveLineIds.length ? this.writeRecord('stock.move.line', moveLineIds, updateOriginVals).catch(() => null) : null,
        ]);
      }

      const dtPromises: Promise<unknown>[] = [];
      if (valDtPickingField) {
        dtPromises.push(this.writeRecord('stock.picking', [pickingId], { [valDtPickingField]: nowFormatted }).catch(() => null));
      }
      if (valDtMoveField && moveIds.length) {
        dtPromises.push(this.writeRecord('stock.move', moveIds, { [valDtMoveField]: nowFormatted }).catch(() => null));
      }
      if (valDtLineField && moveLineIds.length) {
        dtPromises.push(this.writeRecord('stock.move.line', moveLineIds, { [valDtLineField]: nowFormatted }).catch(() => null));
      }
      const fallbackDtFields = ['x_studio_validation_datetime', 'x_validation_datetime', 'x_validation_date', 'x_studio_validation_date'];
      if (!valDtPickingField) {
        for (const f of fallbackDtFields) {
          dtPromises.push(this.writeRecord('stock.picking', [pickingId], { [f]: nowFormatted }).catch(() => null));
        }
      }
      if (!valDtMoveField && moveIds.length) {
        for (const f of fallbackDtFields) {
          dtPromises.push(this.writeRecord('stock.move', moveIds, { [f]: nowFormatted }).catch(() => null));
        }
      }
      if (!valDtLineField && moveLineIds.length) {
        for (const f of fallbackDtFields) {
          dtPromises.push(this.writeRecord('stock.move.line', moveLineIds, { [f]: nowFormatted }).catch(() => null));
        }
      }
      await Promise.all(dtPromises);

      if (actorEmail) {
        const writePromises: Promise<unknown>[] = [];
        if (operatorPickingField) {
          writePromises.push(this.writeRecord('stock.picking', [pickingId], { [operatorPickingField]: actorEmail }).catch(() => null));
        }
        if (operatorMoveField && moveIds.length) {
          writePromises.push(this.writeRecord('stock.move', moveIds, { [operatorMoveField]: actorEmail }).catch(() => null));
        }
        if (operatorLineField && moveLineIds.length) {
          writePromises.push(this.writeRecord('stock.move.line', moveLineIds, { [operatorLineField]: actorEmail }).catch(() => null));
        }
        const fallbackFields = ['x_studio_operator_online', 'x_operator_online', 'x_operator', 'x_studio_operator'];
        if (!operatorPickingField) {
          for (const f of fallbackFields) {
            writePromises.push(this.writeRecord('stock.picking', [pickingId], { [f]: actorEmail }).catch(() => null));
          }
        }
        if (!operatorMoveField && moveIds.length) {
          for (const f of fallbackFields) {
            writePromises.push(this.writeRecord('stock.move', moveIds, { [f]: actorEmail }).catch(() => null));
          }
        }
        if (!operatorLineField && moveLineIds.length) {
          for (const f of fallbackFields) {
            writePromises.push(this.writeRecord('stock.move.line', moveLineIds, { [f]: actorEmail }).catch(() => null));
          }
        }
        await Promise.all(writePromises);
      }
    } catch {
      // Non-blocking metadata enrichment
    }
  }

  /**
   * Adjusts the required board component quantity (product_uom_qty on stock.move)
   * on a Cutting MO when a Purchase Order or Board Intake quantity mismatch occurs.
   * Posts a labeled plain-text audit note on the MO chatter and re-evaluates reservation.
   */
  async adjustMOComponentQuantity(
    moId: number,
    productId: number,
    targetQty: number,
    sourceDescription: string,
    actorName?: string,
  ): Promise<boolean> {
    if (!Number.isFinite(targetQty) || targetQty <= 0) return false;
    try {
      const moves = await this.searchReadRecords<{
        id: number;
        product_id: [number, string] | false;
        product_uom_qty: number;
      }>('stock.move', {
        domain: [
          ['raw_material_production_id', '=', moId],
          ['product_id', '=', productId],
        ],
        fields: ['id', 'product_id', 'product_uom_qty'],
        limit: 10,
      });

      if (!moves.length) return false;

      let updated = false;
      for (const move of moves) {
        const currentQty = Number(move.product_uom_qty || 0);
        if (Math.abs(currentQty - targetQty) > 0.001) {
          await this.writeRecord('stock.move', [move.id], { product_uom_qty: targetQty });
          updated = true;
          const productName = Array.isArray(move.product_id) ? move.product_id[1] : `Board #${productId}`;
          const actorInfo = actorName ? `\nUpdated by: ${actorName}` : '';
          const auditNote = `Component quantity updated: ${productName} required quantity adjusted from ${currentQty} to ${targetQty} based on ${sourceDescription}.${actorInfo}`;
          await this.postModelChatterMessage('mrp.production', moId, auditNote).catch(() => null);
        }
      }

      if (updated) {
        await this.callRecordMethod('mrp.production', 'action_assign', [moId]).catch(() => null);
      }
      return updated;
    } catch (err) {
      console.warn(`[OdooClient] Failed to adjust MO ${moId} component quantity:`, err);
      return false;
    }
  }

  /**
   * Reconciles MO raw material component quantities with related Purchase Orders.
   * Checks if any linked PO lines specify a different board quantity than what the MO requires,
   * and updates the MO component product_uom_qty accordingly.
   */
  async reconcileMOComponentQuantitiesWithRelatedPO(moId: number, actorName?: string): Promise<void> {
    try {
      const mos = await this.searchReadRecords<{ id: number; name: string; origin: string | false }>('mrp.production', {
        domain: [['id', '=', moId]],
        fields: ['id', 'name', 'origin'],
        limit: 1,
      });
      if (!mos.length || !mos[0].origin) return;
      const mo = mos[0];
      const originName = String(mo.origin).trim();

      const pos = await this.searchReadRecords<{ id: number; name: string }>('purchase.order', {
        domain: [['origin', 'ilike', originName]],
        fields: ['id', 'name'],
        limit: 10,
      });
      if (!pos.length) return;

      const poIds = pos.map((p) => p.id);
      const poLines = await this.searchReadRecords<{
        order_id: [number, string];
        product_id: [number, string] | false;
        product_qty: number;
      }>('purchase.order.line', {
        domain: [['order_id', 'in', poIds]],
        fields: ['order_id', 'product_id', 'product_qty'],
        limit: 200,
      });

      const poProductQtyMap = new Map<number, { poName: string; qty: number }>();
      const poNameMap = new Map<number, string>(pos.map((p) => [p.id, p.name]));

      for (const line of poLines) {
        if (line.product_id && Array.isArray(line.product_id)) {
          const prodId = line.product_id[0];
          const poId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
          const poName = poNameMap.get(poId) || 'PO';
          const qty = Number(line.product_qty || 0);
          if (qty > 0) {
            poProductQtyMap.set(prodId, { poName, qty });
          }
        }
      }

      if (!poProductQtyMap.size) return;

      const components = await this.searchReadRecords<{
        id: number;
        product_id: [number, string] | false;
        product_uom_qty: number;
      }>('stock.move', {
        domain: [['raw_material_production_id', '=', moId]],
        fields: ['id', 'product_id', 'product_uom_qty'],
        limit: 100,
      });

      for (const comp of components) {
        if (comp.product_id && Array.isArray(comp.product_id)) {
          const prodId = comp.product_id[0];
          const poInfo = poProductQtyMap.get(prodId);
          if (poInfo && poInfo.qty > 0) {
            await this.adjustMOComponentQuantity(
              moId,
              prodId,
              poInfo.qty,
              `related Purchase Order (${poInfo.poName}) difference`,
              actorName,
            );
          }
        }
      }
    } catch (err) {
      console.warn(`[OdooClient] Failed to reconcile MO ${moId} with related PO:`, err);
    }
  }

  async autoReserveConfirmedMOs(warehouseId: number): Promise<{ reserved: number[]; failed: number[] }> {
    try {
      const warehouse = await this.getVerifiedTargetWarehouse(warehouseId);
      const openMOs = await this.searchReadRecords<{ id: number; name: string }>('mrp.production', {
        domain: [
          ['company_id', '=', warehouse.companyId],
          ['picking_type_id.warehouse_id', '=', warehouse.id],
          ['state', 'in', ['confirmed', 'progress', 'to_close']],
        ],
        fields: ['id', 'name'],
        limit: 500,
      });
      if (!openMOs.length) return { reserved: [], failed: [] };
      for (const mo of openMOs) {
        await this.reconcileMOComponentQuantitiesWithRelatedPO(mo.id).catch(() => null);
      }
      return this.reserveStockOnMOs(openMOs.map((mo) => mo.id));
    } catch (err) {
      console.warn('[OdooClient] autoReserveConfirmedMOs error:', err);
      return { reserved: [], failed: [] };
    }
  }

  async validateBoardReceipt(pickingId: number, actorEmail: string, warehouseId: number) {
    const receipt = await this.assertPickingBelongsToWarehouse(pickingId, warehouseId, 'incoming');
    await this.postModelChatterMessage('stock.picking', pickingId, `Receipt validation performed in OPERATOR MOBILE APP\nUser: ${actorEmail}\nDate: ${new Date().toISOString()}`);
    if (receipt.state === 'draft') await this.callRecordMethod('stock.picking', 'action_confirm', [pickingId]);
    await this.callRecordMethod('stock.picking', 'action_assign', [pickingId]).catch(() => null);
    await this.populatePickingValidationMetadata(pickingId, actorEmail);
    const result = await this.callRecordMethod('stock.picking', 'button_validate', [pickingId]);
    await this.populatePickingValidationMetadata(pickingId, actorEmail);
    await this.autoReserveConfirmedMOs(warehouseId).catch(() => null);
    return result;
  }

  async getOpenDeliveries(warehouseId: number) {
    const warehouse = await this.getVerifiedTargetWarehouse(warehouseId);
    const pickings = await this.searchReadRecords<any>('stock.picking', {
      domain: [['company_id', '=', warehouse.companyId], ['picking_type_id.warehouse_id', '=', warehouse.id], ['picking_type_code', '=', 'outgoing'], ['state', 'in', ['waiting', 'confirmed', 'assigned']]],
      fields: ['id', 'name', 'partner_id', 'origin', 'state', 'scheduled_date'],
      limit: 200,
      order: 'scheduled_date asc, id asc',
    });
    const scopedPickings = pickings.filter((p) => String(p.name || '').toUpperCase().startsWith(`${warehouse.code}/OUT/`));
    if (!scopedPickings.length) return [];
    const moves = await this.searchReadRecords<any>('stock.move', {
      domain: [['picking_id', 'in', scopedPickings.map((p) => p.id)], ['state', 'not in', ['done', 'cancel']]],
      fields: ['picking_id', 'product_id', 'product_uom_qty', 'quantity'],
      limit: 3000,
    });
    const byPicking = new Map<number, any[]>();
    moves.forEach((move) => {
      const id = Array.isArray(move.picking_id) ? move.picking_id[0] : move.picking_id;
      if (!byPicking.has(id)) byPicking.set(id, []);
      byPicking.get(id)!.push({
        name: Array.isArray(move.product_id) ? String(move.product_id[1] || '') : 'Item',
        ordered: Number(move.product_uom_qty || 0),
        delivered: Number(move.quantity || 0),
      });
    });
    return scopedPickings.map((p) => ({ ...p, items: byPicking.get(p.id) || [] }));
  }

  async validateDelivery(pickingId: number, actorEmail: string, warehouseId: number) {
    const delivery = await this.assertPickingBelongsToWarehouse(pickingId, warehouseId, 'outgoing');
    if (delivery.state !== 'assigned') {
      throw new OdooClientError('This delivery is not ready yet. Complete the preceding operation or reserve its stock in Odoo first.');
    }
    await this.postModelChatterMessage('stock.picking', pickingId, `Delivery validation performed in OPERATOR MOBILE APP\nUser: ${actorEmail}\nDate: ${new Date().toISOString()}`);
    await this.populatePickingValidationMetadata(pickingId, actorEmail);
    const result = await this.callRecordMethod('stock.picking', 'button_validate', [pickingId]);
    await this.populatePickingValidationMetadata(pickingId, actorEmail);
    return result;
  }

  async advanceManufacturingOrder(moId: number, action: 'start' | 'finish', employeeId?: number) {
    if (!employeeId || !Number.isSafeInteger(employeeId)) {
      throw new OdooClientError('Your account is not linked to a valid Odoo employee.');
    }
    const [productions, workorders] = await Promise.all([
      this.searchReadRecords<{ id: number; name: string; state: string }>('mrp.production', {
        domain: [['id', '=', moId]],
        fields: ['id', 'name', 'state'],
        limit: 1,
      }),
      this.searchReadRecords<{
        id: number;
        state: string;
        workcenter_id: [number, string] | false;
        employee_ids: number[];
        qty_producing: number;
        qty_production: number;
      }>('mrp.workorder', {
        domain: [['production_id', '=', moId], ['state', 'not in', ['done', 'cancel']]],
        fields: ['id', 'state', 'workcenter_id', 'employee_ids', 'qty_producing', 'qty_production'],
        limit: 100,
        order: 'id asc',
      }),
    ]);
    const production = productions[0];
    if (!production || ['done', 'cancel'].includes(production.state)) {
      throw new OdooClientError('This manufacturing order is no longer active.');
    }
    if (!String(production.name || '').toUpperCase().startsWith('WH/MO/')) {
      throw new OdooClientError('This manufacturing order is outside the Shop Floor warehouse.');
    }

    const assertEmployeeMayUseWorkcenter = async (workorder: {
      id: number;
      workcenter_id: [number, string] | false;
    }) => {
      if (!Array.isArray(workorder.workcenter_id)) {
        throw new OdooClientError('This operation has no Odoo work centre assigned.');
      }
      const workcenters = await this.searchReadRecords<{ id: number; employee_ids: number[] }>('mrp.workcenter', {
        domain: [['id', '=', workorder.workcenter_id[0]]],
        fields: ['id', 'employee_ids'],
        limit: 1,
      });
      const allowedEmployees = workcenters[0]?.employee_ids || [];
      if (allowedEmployees.length && !allowedEmployees.includes(employeeId)) {
        throw new OdooClientError(
          `You are not assigned to ${workorder.workcenter_id[1]} in Odoo. Ask an administrator to add you under Allowed Employees.`,
        );
      }
    };

    if (action === 'start') {
      const workorder = workorders.find((item) => item.state === 'ready' || item.state === 'pending') || workorders.find((item) => item.state !== 'progress');
      if (!workorder) {
        if (workorders.some((item) => item.state === 'progress')) return;
        throw new OdooClientError('No work operation is available to start for this manufacturing order.');
      }
      await assertEmployeeMayUseWorkcenter(workorder);
      if (workorder.state === 'pending') {
        try {
          await this.callRecordMethod('mrp.workorder', 'button_start', [workorder.id]);
        } catch (_) {}
      }
      try {
        await this.callRecordMethod(
          'mrp.workorder',
          'start_employee',
          [workorder.id],
          {
            employee_id: employeeId,
            context: { mrp_display: true },
          },
        );
      } catch (_) {}
      const verifiedWorkorder = await this.searchReadRecords<{ id: number; state: string; employee_ids: number[] }>('mrp.workorder', {
        domain: [['id', '=', workorder.id]],
        fields: ['id', 'state', 'employee_ids'],
        limit: 1,
      });
      if (verifiedWorkorder[0]?.state !== 'progress') {
        try {
          await this.callRecordMethod('mrp.workorder', 'button_start', [workorder.id]);
        } catch (_) {}
      }
      return { workorderId: workorder.id, state: 'progress' as const, operatorLinked: true };
    }

    const activeWorkorder = workorders.find((item) => item.state === 'progress');
    if (!activeWorkorder) {
      throw new OdooClientError('This manufacturing order has no operation in progress.');
    }
    await assertEmployeeMayUseWorkcenter(activeWorkorder);
    if (!(activeWorkorder.employee_ids || []).includes(employeeId)) {
      await this.callRecordMethod(
        'mrp.workorder',
        'start_employee',
        [activeWorkorder.id],
        {
          employee_id: employeeId,
          context: { mrp_display: true },
        },
      );
    }
    if (Number(activeWorkorder.qty_producing || 0) <= 0) {
      const quantityToProduce = Number(activeWorkorder.qty_production || 0);
      if (quantityToProduce <= 0) {
        throw new OdooClientError(
          'Odoo has no production quantity for this operation. Set its quantity before finishing.',
        );
      }
      await this.writeRecord('mrp.workorder', [activeWorkorder.id], {
        qty_producing: quantityToProduce,
      });
    }
    await this.callRecordMethod(
      'mrp.workorder',
      'stop_employee',
      [activeWorkorder.id],
      {
        employee_ids: [employeeId],
        context: { mrp_display: true },
      },
    );
    await this.callRecordMethod(
      'mrp.workorder',
      'do_finish',
      [activeWorkorder.id],
      {
        context: {
          no_start_next: true,
          mrp_display: true,
          employee_id: employeeId,
        },
      },
    );
    const verification = await this.searchReadRecords<{ id: number; state: string }>('mrp.workorder', {
      domain: [['id', '=', activeWorkorder.id]],
      fields: ['id', 'state'],
      limit: 1,
    });
    if (verification[0]?.state !== 'done') {
      throw new OdooClientError('Odoo did not verify that the operation was completed.');
    }
    return { workorderId: activeWorkorder.id, state: 'done' as const, operatorLinked: true };
  }

  async pauseManufacturingOrder(
    moId: number,
    options: { createBackorder?: boolean; qtyProduced?: number },
    employeeId?: number,
  ) {
    if (!employeeId || !Number.isSafeInteger(employeeId)) {
      throw new OdooClientError('Your account is not linked to a valid Odoo employee.');
    }
    const [productions, workorders] = await Promise.all([
      this.searchReadRecords<{ id: number; name: string; state: string }>('mrp.production', {
        domain: [['id', '=', moId]],
        fields: ['id', 'name', 'state'],
        limit: 1,
      }),
      this.searchReadRecords<{
        id: number;
        state: string;
        workcenter_id: [number, string] | false;
        employee_ids: number[];
      }>('mrp.workorder', {
        domain: [['production_id', '=', moId], ['state', 'in', ['progress', 'ready']]],
        fields: ['id', 'state', 'workcenter_id', 'employee_ids'],
        limit: 100,
        order: 'id asc',
      }),
    ]);
    const production = productions[0];
    if (!production || ['done', 'cancel'].includes(production.state)) {
      throw new OdooClientError('This manufacturing order is no longer active.');
    }

    const activeWorkorder = workorders.find((item) => item.state === 'progress') || workorders[0];
    if (activeWorkorder) {
      await this.callRecordMethod(
        'mrp.workorder',
        'stop_employee',
        [activeWorkorder.id],
        {
          employee_ids: [employeeId],
          context: { mrp_display: true },
        },
      ).catch(() => null);

      await this.callRecordMethod(
        'mrp.workorder',
        'button_pending',
        [activeWorkorder.id],
        { context: { mrp_display: true } },
      ).catch(() => null);
    }

    const backorderNotice = options.createBackorder
      ? ' with backorder requested for remaining units'
      : '';
    const auditNote = `Manufacturing Order paused by Operator${backorderNotice}.`;
    await this.postModelChatterMessage('mrp.production', moId, auditNote).catch(() => null);

    return { moId, state: 'paused' as const, backorderRequested: Boolean(options.createBackorder) };
  }

  /**
   * Find manufacturing orders that need a specific board product as a component,
   * matching a specific client (partner_id), where the linked SO has no purchase
   * order covering that board product.
   *
   * Logic:
   * 1. Find active MOs (confirmed/progress) for this partner
   * 2. Get their raw material moves and filter for the target board product
   * 3. Exclude MOs whose origin SO has a PO that includes the same board product
   * 4. Return most recently created first
   */
  async findMOsForBoardIntake(input: {
    productId: number;
    partnerId: number;
  }): Promise<Array<{
    moId: number;
    moName: string;
    origin: string | null;
    qtyNeeded: number;
    qtyReserved: number;
    state: string;
  }>> {
    try {
      // 1. Find active MOs for this partner (via the MO's origin → sale.order → partner)
      //    First, try direct partner_id on mrp.production (some Odoo setups have this)
      const activeMOs = await this.searchReadRecords<{
        id: number;
        name: string;
        state: string;
        origin: string | null;
        create_date: string | null;
      }>('mrp.production', {
        domain: [
          ['state', 'in', ['confirmed', 'progress']],
        ],
        fields: ['id', 'name', 'state', 'origin', 'create_date'],
        limit: 200,
        order: 'create_date desc, id desc',
      });

      if (!activeMOs.length) return [];

      // 2. Get raw material component moves for these MOs
      const moIds = activeMOs.map(mo => mo.id);
      const rawMoves = await this.getBulkManufacturingOrderComponents(moIds);

      // Filter moves to those requiring the target board product
      const matchingMoves = rawMoves.filter(m => {
        const productId = Array.isArray(m.product_id) ? m.product_id[0] : 0;
        return productId === input.productId;
      });

      if (!matchingMoves.length) return [];

      // Get the set of MO IDs that need this board product
      const moIdsNeedingBoard = new Set(
        matchingMoves.map(m => {
          const rmId = Array.isArray(m.raw_material_production_id)
            ? m.raw_material_production_id[0]
            : m.raw_material_production_id;
          return rmId;
        })
      );

      // Filter MOs to only those needing the board
      const candidateMOs = activeMOs.filter(mo => moIdsNeedingBoard.has(mo.id));
      if (!candidateMOs.length) return [];

      // 3. Check which MOs' origin SOs belong to this partner
      const originNames = [...new Set(
        candidateMOs.map(mo => mo.origin).filter(Boolean) as string[]
      )];

      let clientFilteredMOs = candidateMOs;

      if (originNames.length > 0) {
        // Get partner_id for each SO
        const soPartners = await this.searchReadRecords<{
          name: string;
          partner_id: [number, string] | false;
        }>('sale.order', {
          domain: [['name', 'in', originNames]],
          fields: ['name', 'partner_id'],
          limit: 500,
        });

        const soPartnerMap = new Map<string, number>();
        for (const so of soPartners) {
          if (so.partner_id && Array.isArray(so.partner_id)) {
            soPartnerMap.set(so.name, so.partner_id[0]);
          }
        }

        // Filter: only MOs where the SO's partner matches the intake partner
        clientFilteredMOs = candidateMOs.filter(mo => {
          if (!mo.origin) return false;
          const soPartnerId = soPartnerMap.get(mo.origin);
          return soPartnerId === input.partnerId;
        });
      } else {
        // No origins — can't match by client, return empty
        return [];
      }

      if (!clientFilteredMOs.length) return [];

      // 4. Exclude MOs whose origin SO has a PO with a board product line
      const filteredOrigins = [...new Set(
        clientFilteredMOs.map(mo => mo.origin).filter(Boolean) as string[]
      )];

      const purchaseOrders = filteredOrigins.length > 0
        ? await this.searchReadRecords<{
            id: number;
            origin: string | false;
          }>('purchase.order', {
            domain: [['origin', 'in', filteredOrigins]],
            fields: ['id', 'origin'],
            limit: 500,
          })
        : [];

      // Check PO lines for board products
      const soOriginsWithBoardPO = new Set<string>();
      if (purchaseOrders.length > 0) {
        const poIds = purchaseOrders.map(po => po.id);
        const poLines = await this.searchReadRecords<{
          order_id: [number, string];
          product_id: [number, string] | false;
        }>('purchase.order.line', {
          domain: [['order_id', 'in', poIds]],
          fields: ['order_id', 'product_id'],
          limit: 2000,
        });

        // Map PO ID to origin
        const poOriginMap = new Map<number, string>();
        for (const po of purchaseOrders) {
          if (po.origin) poOriginMap.set(po.id, po.origin);
        }

        for (const line of poLines) {
          const productName = Array.isArray(line.product_id) ? line.product_id[1] : '';
          const poId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
          // Check if the PO line is for the SAME board product
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : 0;
          if (productId === input.productId) {
            const origin = poOriginMap.get(poId);
            if (origin) soOriginsWithBoardPO.add(origin);
          }
        }
      }

      // Exclude MOs whose SO has a PO covering this board
      const finalMOs = clientFilteredMOs.filter(mo => {
        if (!mo.origin) return false;
        return !soOriginsWithBoardPO.has(mo.origin);
      });

      // 5. Build result with quantity info from the matching moves
      return finalMOs.map(mo => {
        const move = matchingMoves.find(m => {
          const rmId = Array.isArray(m.raw_material_production_id)
            ? m.raw_material_production_id[0]
            : m.raw_material_production_id;
          return rmId === mo.id;
        });

        return {
          moId: mo.id,
          moName: mo.name,
          origin: mo.origin,
          qtyNeeded: move ? Number(move.product_uom_qty || 0) : 0,
          qtyReserved: move ? Number(move.quantity || 0) : 0,
          state: mo.state,
        };
      });
    } catch (err) {
      console.error('[OdooClient] Failed to find MOs for board intake:', err);
      return [];
    }
  }

  /**
   * Reserve stock on manufacturing orders by calling action_assign.
   * This triggers Odoo's built-in reservation engine to allocate available stock.
   */
  async reserveStockOnMOs(moIds: number[]): Promise<{ reserved: number[]; failed: number[] }> {
    const reserved: number[] = [];
    const failed: number[] = [];

    for (const moId of moIds) {
      try {
        await this.callRecordMethod('mrp.production', 'action_assign', [moId]);
        reserved.push(moId);
      } catch (err) {
        console.warn(`[OdooClient] Failed to reserve stock on MO ${moId}:`, err);
        failed.push(moId);
      }
    }

    return { reserved, failed };
  }

  /**
   * Fetch pending board component requirements for active MOs of a specific client.
   * Only returns components where the origin SO has no Purchase Order covering that board.
   */
  async getCustomerBoardRequirements(partnerId: number): Promise<Array<{
    moId: number;
    moName: string;
    origin: string | null;
    productId: number;
    productName: string;
    qtyNeeded: number;
    qtyReserved: number;
    qtyMissing: number;
  }>> {
    try {
      // 1. Get all active MOs
      const activeMOs = await this.searchReadRecords<{
        id: number;
        name: string;
        state: string;
        origin: string | null;
      }>('mrp.production', {
        domain: [['state', 'in', ['confirmed', 'progress']]],
        fields: ['id', 'name', 'state', 'origin'],
        limit: 200,
        order: 'create_date desc, id desc',
      });

      if (!activeMOs.length) return [];

      // 2. Filter active MOs to the ones matching partnerId (via SO partner_id)
      const originNames = [...new Set(activeMOs.map(mo => mo.origin).filter(Boolean) as string[])];
      if (originNames.length === 0) return [];

      const soPartners = await this.searchReadRecords<{
        name: string;
        partner_id: [number, string] | false;
      }>('sale.order', {
        domain: [['name', 'in', originNames]],
        fields: ['name', 'partner_id'],
        limit: 500,
      });

      const soPartnerMap = new Map<string, number>();
      for (const so of soPartners) {
        if (so.partner_id && Array.isArray(so.partner_id)) {
          soPartnerMap.set(so.name, so.partner_id[0]);
        }
      }

      const clientMOs = activeMOs.filter(mo => {
        if (!mo.origin) return false;
        return soPartnerMap.get(mo.origin) === partnerId;
      });

      if (!clientMOs.length) return [];

      // 3. Get raw components for client MOs
      const moIds = clientMOs.map(mo => mo.id);
      const rawMoves = await this.getBulkManufacturingOrderComponents(moIds);

      // Filter moves to only board products
      const boardMoves = rawMoves.filter(m => {
        const productName = Array.isArray(m.product_id) ? m.product_id[1] : '';
        return isBoardProductName(productName);
      });

      if (!boardMoves.length) return [];

      // 4. Exclude moves that have corresponding POs for this board product
      const clientOrigins = [...new Set(clientMOs.map(mo => mo.origin).filter(Boolean) as string[])];

      const purchaseOrders = clientOrigins.length > 0
        ? await this.searchReadRecords<{
            id: number;
            origin: string | false;
          }>('purchase.order', {
            domain: [['origin', 'in', clientOrigins]],
            fields: ['id', 'origin'],
            limit: 500,
          })
        : [];

      const originProductPOKeys = new Set<string>();
      if (purchaseOrders.length > 0) {
        const poIds = purchaseOrders.map(po => po.id);
        const poLines = await this.searchReadRecords<{
          order_id: [number, string];
          product_id: [number, string] | false;
        }>('purchase.order.line', {
          domain: [['order_id', 'in', poIds]],
          fields: ['order_id', 'product_id'],
          limit: 2000,
        });

        const poOriginMap = new Map<number, string>();
        for (const po of purchaseOrders) {
          if (po.origin) poOriginMap.set(po.id, po.origin);
        }

        for (const line of poLines) {
          const poId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : 0;
          const origin = poOriginMap.get(poId);
          if (origin && productId) {
            originProductPOKeys.add(`${origin}_${productId}`);
          }
        }
      }

      // Build requirement list
      const requirements: Array<{
        moId: number;
        moName: string;
        origin: string | null;
        productId: number;
        productName: string;
        qtyNeeded: number;
        qtyReserved: number;
        qtyMissing: number;
      }> = [];

      for (const move of boardMoves) {
        const moId = Array.isArray(move.raw_material_production_id)
          ? move.raw_material_production_id[0]
          : move.raw_material_production_id;

        const mo = clientMOs.find(m => m.id === moId);
        if (!mo) continue;

        const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
        const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';

        // Check if there is a PO for this SO origin and product
        if (mo.origin && originProductPOKeys.has(`${mo.origin}_${productId}`)) {
          continue; // Exclude since PO exists
        }

        const qtyNeeded = Number(move.product_uom_qty || 0);
        const qtyReserved = Number(move.quantity || 0);
        const qtyMissing = Math.max(0, qtyNeeded - qtyReserved);

        if (qtyMissing > 0) {
          requirements.push({
            moId: mo.id,
            moName: mo.name,
            origin: mo.origin,
            productId,
            productName,
            qtyNeeded,
            qtyReserved,
            qtyMissing,
          });
        }
      }

      return requirements;
    } catch (err) {
      console.error('[OdooClient] Failed to get customer board requirements:', err);
      return [];
    }
  }
}
