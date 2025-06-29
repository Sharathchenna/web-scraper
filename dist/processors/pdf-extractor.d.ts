import { Document, PDFIngestorConfig } from '../types/index.js';
export interface PDFExtractResult {
    success: boolean;
    documents?: Document[];
    error?: string;
}
export declare class PDFExtractor {
    extractFromPDF(filePath: string, config: PDFIngestorConfig): Promise<PDFExtractResult>;
    private formatAsMarkdown;
    private createMetadata;
    private countWords;
    private generateDocumentId;
}
//# sourceMappingURL=pdf-extractor.d.ts.map