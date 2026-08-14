export type ConnectionStatus = 'unknown' | 'success' | 'error' | 'not_configured';

export interface OdooCredentials {
  baseUrl: string;
  database: string;
  username: string;
  apiKey: string;
  shopFloorPassword?: string;
}

export interface FieldMappings {
  edgeJsonField: string;
  processedField: string;
  processedAtField: string;
  logField: string;
  attachmentNameField: string;
  attachmentIdField: string;
  previousJsonField: string;
  signatureField: string;
  stockProcessedField: string;
  stockSignatureField: string;
  deltaJsonField: string;
}

export interface ParserConfig {
  filenameKeyword: string;
  sectionHeader: string;
  stopHeadersCsv: string;
  productLinePattern: string;
  thicknessLabel: string;
  lengthLabel: string;
  rollLengthLabel: string;
  postChatterOnSuccess: boolean;
  chatterTemplate: string;
}

export type AiInvoiceProvider =
  | 'disabled'
  | 'openai'
  | 'nvidia'
  | 'gemini'
  | 'anthropic'
  | 'openrouter';

export interface AiProviderApiKeys {
  openai: string;
  nvidia: string;
  gemini: string;
  anthropic: string;
  openrouter: string;
}

export interface GeminiOAuthConnectionStatus {
  connected: boolean;
  email: string;
  projectId: string;
  connectedAt: string | null;
  clientId: string;
  hasClientSecret: boolean;
}

export interface AiExtractionConfig {
  enabled: boolean;
  provider: AiInvoiceProvider;
  model: string;
  baseUrl: string;
  confidenceThreshold: number;
  maxImages: number;
  apiKeys: AiProviderApiKeys;
  nvidiaModelKeys: Record<string, string>;
  geminiOAuth: GeminiOAuthConnectionStatus;
  ocr: {
    provider: 'disabled' | 'nvidia_nemoretriever' | 'gemini_vision' | 'google';
    enabled: boolean;
    geminiFallbackEnabled: boolean;
    model: string;
    endpoint: string;
    apiKey: string;
  };
}

export interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  batchSize: number;
  confirmedFromDate: string;
  cronToken: string;
  useInProcessInterval: boolean;
}

export interface PoBillSchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  batchSize: number;
  fromDate: string;
  cronToken: string;
  useInProcessInterval: boolean;
  maxRetryAttempts: number;
  transientRetryHours: number;
  retryBackoffHours: number[];
  stableSkipRetryDays: number;
}

export interface StockConfig {
  locationId: string;
  locationName: string;
  warehouseId: string;
  pickingTypeId: string;
  missingSoAlertUserLogin: string;
  missingComponentAlertUserLogin: string;
}

export type MailTransportMode = 'smtp';
export type MailFallbackTransportMode = 'none';

export interface OutgoingMailAccount {
  label: string;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

export type EmailAutomationFrequency = 'hourly' | 'daily' | 'weekly';

export interface EmailAutomation {
  id: string;
  name: string;
  systemKey: 'shop-floor-reminders' | 'weekly-shop-floor-report' | 'mpesa-review' | 'mo-overtime' | 'custom';
  enabled: boolean;
  frequency: EmailAutomationFrequency;
  interval: number;
  dayOfWeek: number;
  hour: number;
  recipients: string;
  subject: string;
  body: string;
  lastSentAt: string;
}

export interface MailConfig {
  transport: MailTransportMode;
  fallbackTransport: MailFallbackTransportMode;
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  ignoreTls: boolean;
  tlsRejectUnauthorized: boolean;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
  testRecipient: string;
  accounts: OutgoingMailAccount[];
  automations: EmailAutomation[];
  shopFloorReportingStartDate: string;
}

export interface PayrollBridgeConfig {
  url: string;
  token: string;
  source: string;
  autoCreatePayRun: boolean;
  salaryStructure: string;
  payRunNameTemplate: string;
}

export interface ConnectionState {
  status: ConnectionStatus;
  checkedAt: string | null;
  message: string | null;
  version: string | null;
}

export type AuthRole = 'admin' | 'user';

export type AppFeature = 
  | 'mpesa' 
  | 'po-automation' 
  | 'purchase-orders' 
  | 'sales-orders' 
  | 'invoice-parser' 
  | 'extractions'
  | 'shop-floor'
  | 'shop-floor-admin'
  | 'jobs';

export interface AuthSessionUser {
  email: string;
  displayName?: string;
  role?: AuthRole;
  apps?: AppFeature[];
}

export type DatabaseDriver = 'sqlite' | 'mysql';

export interface RuntimeDatabaseConfig {
  driver: DatabaseDriver;
  sqlitePath: string;
  mysqlHost: string;
  mysqlPort: string;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
  mysqlConnectionLimit: string;
}

export interface AppSettings {
  odoo: OdooCredentials;
  fieldMappings: FieldMappings;
  parser: ParserConfig;
  ai: AiExtractionConfig;
  scheduler: SchedulerConfig;
  poBillScheduler: PoBillSchedulerConfig;
  stock: StockConfig;
  mail: MailConfig;
  payrollBridge: PayrollBridgeConfig;
  connection: ConnectionState;
  updatedAt: string | null;
}

export type ShopFloorFeatureKey =
  | 'start-finish'
  | 'add-stock'
  | 'receipts'
  | 'deliveries'
  | 'attendance'
  | 'maintenance'
  | 'payroll'
  | 'table-saw'
  | 'edge-banding'
  | 'panel-rack';

export type ShopFloorFeatureFlags = Record<ShopFloorFeatureKey, boolean>;

export interface OdooModelField {
  name: string;
  label: string;
  type: string;
}

export interface OdooModelFieldCache {
  modelName: string;
  fields: OdooModelField[];
  fetchedAt: string | null;
}

export interface ProcessedStockItemEntry {
  id: string;
  orderId: number;
  extractionSignature: string;
  variantId: number;
  normalizedColor: string;
  quantityAddedMeters: number;
  historyId: string | null;
  createdAt: string;
}

export interface AuthLoginChallengeEntry {
  id: string;
  email: string;
  codeHash: string;
  redirectPath: string;
  expiresAt: string;
  attemptsRemaining: number;
  consumedAt: string | null;
  requestedIp: string | null;
  createdAt: string;
}

export interface AuthSessionEntry {
  id: string;
  user: AuthSessionUser;
  csrfToken: string;
  userAgentHash: string;
  ipAddress: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
}
export interface AuthApprovedUser {
  email: string;
  role: AuthRole;
  apps?: AppFeature[];
  active: boolean;
  passwordHash?: string | null;
  hasPassword?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthLoginEventEntry {
  id: string;
  email: string | null;
  role: AuthRole | null;
  eventType: 'login' | 'logout' | 'activity' | 'password_reset';
  authMethod: string | null;
  success: boolean;
  ipAddress: string | null;
  locationLabel: string | null;
  locationSource: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: string;
}

export type SignatureComparisonResult = 'match' | 'different' | 'missing';

export type OdooWriteErrorType =
  | 'invalid_field'
  | 'access_denied'
  | 'api_failure'
  | 'network_error';

export interface SafeSaleOrderUpdateResult {
  success: boolean;
  message: string;
  sentFields: string[];
  skippedFields: Array<{
    name: string;
    reason: string;
  }>;
  warnings: string[];
  errorType?: OdooWriteErrorType;
}

export interface SalesOrderSummary {
  id: number;
  name: string;
  state?: string | null;
  date_order?: string | null;
  amount_total?: number | null;
  client_order_ref?: string | null;
  company_id?: [number, string] | false | null;
  partner_id?: [number, string] | false | null;
  currency_id?: [number, string] | false | null;
  user_id?: [number, string] | false | null;
  create_uid?: [number, string] | false | null;
}

export interface CustomerInvoiceSummary {
  id: number;
  name: string;
  ref?: string | null;
  state?: string | null;
  move_type?: string | null;
  invoice_date?: string | null;
  date?: string | null;
  amount_total?: number | null;
  amount_residual?: number | null;
  payment_state?: string | null;
  company_id?: [number, string] | false | null;
  partner_id?: [number, string] | false | null;
  currency_id?: [number, string] | false | null;
}

export interface CustomerPaymentSummary {
  id: number;
  name: string;
  ref?: string | null;
  state?: string | null;
  date?: string | null;
  amount?: number | null;
  payment_type?: string | null;
  partner_type?: string | null;
  paid_by?: string | null;
  reconciled_invoice_ids?: number[] | false | null;
  company_id?: [number, string] | false | null;
  partner_id?: [number, string] | false | null;
  currency_id?: [number, string] | false | null;
}

export interface SalesOrderListStatus {
  hasJobSummary: boolean;
  extracted: boolean;
  sentToOdoo: boolean;
  processedStock: boolean;
  addedStock: boolean;
}

export interface SalesOrderListItem extends SalesOrderSummary {
  appStatus: SalesOrderListStatus;
}

export interface SalesOrderDetails extends SalesOrderSummary {
  note?: string | null;
  validity_date?: string | null;
}

export interface SaleOrderLine {
  id: number;
  name: string;
  product_id?: [number, string] | false | null;
  product_uom_qty?: number | null;
  price_subtotal?: number | null;
  price_total?: number | null;
  display_type?: string | false | null;
}

export interface SaleOrderStockHandoff {
  orderId: number;
  orderName: string;
  edgeJson: string;
  previousJson: string;
  signature: string;
  stockSignature: string;
  stockProcessed: boolean;
  stockAdjustmentInputJson: string;
  processingLog: string;
}

export interface AttachmentInfo {
  id: number;
  name: string;
  mimetype?: string | null;
  create_date?: string | null;
  write_date?: string | null;
  file_size?: number | null;
  documentId?: number | null;
  folderName?: string | null;
  companyName?: string | null;
  poBillStatus?: string | null;
  poBillProcessedAt?: string | null;
  poBillPurchaseOrderId?: number | null;
  poBillPurchaseOrderName?: string | null;
  poBillVendorBillId?: number | null;
  poBillVendorBillName?: string | null;
  poBillAttemptCount?: number | null;
  poBillSummary?: string | null;
  poBillValidated?: boolean;
}

export interface PoBillProcessedDocumentEntry {
  attachmentId: number;
  attachmentName: string;
  documentId?: number | null;
  folderName?: string | null;
  companyName?: string | null;
  purchaseOrderId?: number | null;
  purchaseOrderName?: string | null;
  vendorBillId?: number | null;
  vendorBillName?: string | null;
  invoiceFingerprint?: string | null;
  invoiceNumber?: string | null;
  invoiceVendor?: string | null;
  invoiceTotal?: number | null;
  status: 'processed' | 'processed_with_warnings' | 'delivery_note' | 'skipped' | 'failed';
  mode?: 'review' | 'auto' | string | null;
  summary?: string | null;
  processedAt?: string | null;
  updatedAt?: string | null;
  attemptCount?: number | null;
  lastSkippedAt?: string | null;
}

export interface PurchaseOrderListItem extends PurchaseOrderSummary {
  partner_ref?: string | null;
  appStatus: {
    hasAutomationRun: boolean;
    status: PoBillProcessedDocumentEntry['status'] | 'not_processed';
    matchedDocumentName: string | null;
    vendorBillName: string | null;
    processedAt: string | null;
    summary: string | null;
  };
}

export interface DownloadedAttachment {
  id: number;
  name: string;
  mimetype?: string | null;
  fileSize?: number | null;
  content: Buffer;
}

export interface ParsedEdgingItem {
  color: string;
  thickness_mm: number | null;
  length_mm: number | null;
  roll_length_mm: number | null;
}

export interface ParsedJobSummaryResult {
  items: ParsedEdgingItem[];
  sectionFound: boolean;
  sectionText: string;
  rawText: string;
  logs: string[];
}

export interface ParsedVendorInvoiceLine {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface ParsedVendorInvoiceResult {
  vendorName: string | null;
  filenameVendorHint?: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  orderNumber: string | null;
  taxPin: string | null;
  pinNote: 'ETR' | 'NO PIN';
  untaxedTotal: number | null;
  vatTotal: number | null;
  grandTotal: number | null;
  itemCount: number;
  items: ParsedVendorInvoiceLine[];
  rawText: string;
  logs: string[];
}

export interface PurchaseOrderSummary {
  id: number;
  name: string;
  state?: string | null;
  create_date?: string | null;
  date_order?: string | null;
  amount_total?: number | null;
  amount_untaxed?: number | null;
  partner_id?: [number, string] | false | null;
  currency_id?: [number, string] | false | null;
  invoice_status?: string | null;
  user_id?: [number, string] | false | null;
  picking_ids?: number[] | false | null;
  invoice_ids?: number[] | false | null;
  invoice_count?: number | null;
}

export interface PurchaseOrderLine {
  id: number;
  name: string;
  product_id?: [number, string] | false | null;
  product_qty?: number | null;
  qty_received?: number | null;
  qty_invoiced?: number | null;
  price_unit?: number | null;
  price_subtotal?: number | null;
  price_total?: number | null;
}

export interface PoBillAutomationCheck {
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  detail: string;
}

export interface PoBillAutomationCandidate {
  purchaseOrder: PurchaseOrderSummary;
  score: number;
  vendorScore: number;
  totalScore: number;
  dateScore: number;
  itemScore: number;
  receiptScore: number;
  matchingDate?: string | null;
  dateDistanceDays?: number | null;
  creationDateDistanceDays?: number | null;
  reasons: string[];
}

export interface PoBillAutomationResult {
  mode: 'review' | 'auto';
  attachmentId: number;
  attachmentName: string;
  runDurationMs?: number;
  runDurationSeconds?: number;
  purchaseOrder: PurchaseOrderSummary | null;
  purchaseOrders?: PurchaseOrderSummary[];
  candidates: PoBillAutomationCandidate[];
  parsedInvoice: ParsedVendorInvoiceResult;
  checks: PoBillAutomationCheck[];
  canAutoProceed: boolean;
  actionsTaken: string[];
  actionsPending: string[];
}

export interface MpesaStatementBatch {
  id: string;
  originalFilename: string;
  storedFilename: string;
  status: 'processing' | 'parsed' | 'needs_review' | 'failed';
  transactionCount: number;
  pageCount?: number;
  matchedCount: number;
  newCount: number;
  needsFollowupCount: number;
  warningCount: number;
  warnings: string[];
  rawTextPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface MpesaExtractionJob {
  id: string;
  batchId: string;
  jobType: 'upload' | 'reprocess' | 'reupload';
  status: 'pending' | 'running' | 'completed' | 'failed';
  originalFilename: string;
  storedFilename: string;
  previousStoredFilename: string | null;
  errorMessage: string | null;
  transactionCount: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MpesaPurchaseOrderCandidate {
  id: number;
  name: string;
  vendorName: string | null;
  dateOrder: string | null;
  amountTotal: number | null;
  score: number;
  reasons: string[];
}

export interface MpesaTransaction {
  id: string;
  batchId: string;
  rowIndex: number;
  transactionDate: string | null;
  completionTime: string | null;
  receiptNumber: string | null;
  details: string;
  paidIn: number | null;
  withdrawn: number | null;
  balance: number | null;
  amount: number | null;
  direction: 'in' | 'out' | 'neutral' | 'unknown';
  counterparty: string | null;
  phoneNumber: string | null;
  transactionType: string;
  matchedPoId: number | null;
  matchedPoName: string | null;
  matchConfidence: number | null;
  userCategory: string | null;
  userSupplier: string | null;
  reviewStatus: 'new' | 'reviewed' | 'verified' | 'ignored' | 'needs_followup';
  notes: string | null;
  aiNotes: string | null;
  candidates: MpesaPurchaseOrderCandidate[];
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MpesaTransactionExplorerFilters {
  name: string;
  partyRole: 'any' | 'sender' | 'receiver';
  category: string;
  month: string;
  reviewStatus: '' | MpesaTransaction['reviewStatus'];
  statementId: string;
}

export interface MpesaTransactionExplorerRow extends MpesaTransaction {
  effectiveCategory: string;
  batchOriginalFilename: string;
  batchStoredFilename: string;
  batchCreatedAt: string;
}

export interface MpesaTransactionExplorerOptions {
  categories: string[];
  months: string[];
  statements: Array<{
    id: string;
    originalFilename: string;
    createdAt: string;
    transactionCount: number;
  }>;
}

export interface LogEntry {
  id: string;
  historyId?: string | null;
  level: 'info' | 'warn' | 'error';
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  orderId: number;
  orderName: string;
  attachmentId: number;
  attachmentName: string;
  status: string;
  summary: string | null;
  errorMessage: string | null;
  extractedResultId: string | null;
  computedSignature: string | null;
  storedSignature: string | null;
  signatureComparison: SignatureComparisonResult | null;
  sendSkipped: boolean;
  signatureWritten: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedResultEntry {
  id: string;
  historyId: string;
  orderId: number;
  orderName: string;
  attachmentId: number;
  attachmentName: string;
  resultJson: ParsedJobSummaryResult;
  rawText: string;
  pdfSignature: string | null;
  createdAt: string;
}

export interface SignatureDisplayState {
  signatureField: string;
  signatureFieldType: string;
  computedSignature: string | null;
  storedSignature: string | null;
  comparisonResult: SignatureComparisonResult | null;
  comparisonLabel: string;
  canCompare: boolean;
  canForceSend: boolean;
  shouldSkipDefaultSend: boolean;
  warningMessage: string;
}

export interface SchedulerRunEntry {
  id: string;
  status: 'started' | 'completed' | 'completed_with_errors' | 'failed' | 'skipped';
  trigger: 'interval' | 'manual' | 'cron';
  startedAt: string;
  finishedAt: string | null;
  scannedCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  summary: string | null;
  errorMessage: string | null;
  context: Record<string, unknown>;
}

export interface SchedulerRuntimeState {
  lockRunId: string | null;
  lockAcquiredAt: string | null;
  stopRequestedAt: string | null;
  lastSuccessfulRunId: string | null;
  lastSuccessfulFinishedAt: string | null;
  lastCheckpointAt: string | null;
  lastErrorRunId: string | null;
  lastErrorMessage: string | null;
  updatedAt: string | null;
}

export interface SchedulerRunResult {
  run: SchedulerRunEntry;
  scannedCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  throttled?: boolean;
  throttleMinutes?: number;
}

export interface ExtractionViewModel {
  history: HistoryEntry;
  result: ExtractedResultEntry | null;
  logs: LogEntry[];
  signature: SignatureDisplayState;
}

export type StockProcessingItemStatus = 'preview' | 'processed' | 'skipped' | 'failed';

export interface StockProcessingItemResult {
  extractedColor: string;
  normalizedColor: string;
  lengthMm: number;
  usedMeters: number;
  orderedMeters: number | null;
  expectedSoProduct: string;
  soMatched: boolean;
  matchedSoProductName: string;
  moMatched: boolean;
  moState: string;
  componentFound: boolean;
  componentName: string;
  variantId: number | null;
  quantityToAddMeters: number;
  currentStock: number | null;
  newStock: number | null;
  status: StockProcessingItemStatus;
  skipReason: string;
}

export interface StockProcessingSummary {
  totalItems: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  missingSoItemsCount: number;
  missingComponentCount: number;
  zeroQuantityCount: number;
}

export interface StockProcessingRunResult {
  orderId: number;
  orderName: string;
  signature: string;
  preview: boolean;
  source: 'stock_adjustment_input_json' | 'latest_extraction';
  items: StockProcessingItemResult[];
  summary: StockProcessingSummary;
  missingSoProducts: string[];
  alreadyProcessed: boolean;
  lockSkipped: boolean;
  writeBackApplied: boolean;
  statusMessage: string;
}
