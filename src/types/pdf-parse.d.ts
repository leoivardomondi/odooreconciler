declare module 'pdf-parse' {
  export interface PDFParseResult {
    numpages: number;
    numrender: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
    text: string;
  }

  export default function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PDFParseResult>;
}
