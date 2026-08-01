export type SupplierKey =
  | 'COMPLY'
  | 'TIMSALES'
  | 'VINYL_SUPREME'
  | 'TIPTOP'
  | 'JOINBEN'
  | 'UNKNOWN';

export type DocumentType =
  | 'invoice'
  | 'cash_sale'
  | 'delivery_note'
  | 'receipt'
  | 'mixed'
  | 'unknown';

export type PreferredOcr = 'google' | 'tesseract' | 'nvidia_nemoretriever' | 'gemini_vision' | 'auto';
export type AiInvoiceProvider = 'disabled' | 'openai' | 'nvidia' | 'gemini' | 'anthropic' | 'openrouter';

export interface AiInvoiceExtractionConfig {
  enabled: boolean;
  provider: AiInvoiceProvider;
  model: string;
  baseUrl: string;
  confidenceThreshold: number;
  maxImages: number;
  apiKeys: {
    openai: string;
    nvidia: string;
    gemini: string;
    anthropic: string;
    openrouter: string;
  };
  ocr?: {
    provider: 'disabled' | 'nvidia_nemoretriever' | 'gemini_vision' | 'google';
    enabled: boolean;
    model: string;
    endpoint: string;
    apiKey: string;
  };
}

export interface ParsedInvoiceItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  net_amount: number | null;
  vat_rate?: number | null;
  raw_text?: string;
  confidence?: number;
  color?: string | null;
  grain?: string | null;
}

export interface ParsedInvoice {
  supplier: string | null;
  supplier_key: SupplierKey;
  document_type: DocumentType;
  invoice_number: string | null;
  serial_number?: string | null;
  invoice_date: string | null;
  date_of_supply?: string | null;
  customer: string | null;
  customer_pin?: string | null;
  supplier_pin?: string | null;
  currency: 'KES';
  items: ParsedInvoiceItem[];
  totals: {
    goods_total: number | null;
    vat: number | null;
    amount_due: number | null;
  };
  payment_note?: string | null;
  receipt?: {
    kra_invoice_number?: string | null;
    receipt_number?: string | null;
    date?: string | null;
    tax_system?: string | null;
  };
  confidence: {
    supplier: number;
    invoice_number: number;
    date: number;
    items: number;
    totals: number;
    overall: number;
  };
  warnings: string[];
  raw: {
    pdf_text?: string;
    ocr_text?: string;
    ai_json?: unknown;
    pages: Array<{
      page_number: number;
      text: string;
      ocr_used: boolean;
      image_path?: string;
    }>;
  };
}

export interface ParseSupplierInvoiceInput {
  filePath: string;
  originalFilename?: string;
  preferredOcr?: PreferredOcr;
  aiConfig?: AiInvoiceExtractionConfig;
  alwaysOcr?: boolean;
  forceAi?: boolean;
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number | null;
  imagePath: string;
  engine: 'google' | 'tesseract' | 'nvidia_nemoretriever' | 'gemini_vision';
}

export interface ParserContext {
  text: string;
  pdfText: string;
  ocrText: string;
  supplierKey: SupplierKey;
  documentType: DocumentType;
  originalFilename?: string;
  warnings: string[];
}

export interface AiInvoiceExtraction {
  supplier: string | null;
  supplier_key: SupplierKey | null;
  document_type: DocumentType | null;
  invoice_number: string | null;
  serial_number: string | null;
  invoice_date: string | null;
  date_of_supply: string | null;
  account_number: string | null;
  order_number: string | null;
  customer: string | null;
  customer_pin: string | null;
  supplier_pin: string | null;
  sold_by: string | null;
  currency: 'KES' | null;
  items: ParsedInvoiceItem[];
  totals: {
    goods_total: number | null;
    vat: number | null;
    amount_due: number | null;
  };
  confidence: number;
  notes: string[];
}
