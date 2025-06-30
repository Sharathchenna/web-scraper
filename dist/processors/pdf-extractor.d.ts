import { Document, PDFIngestorConfig } from '../types/index.js';
export interface PDFExtractResult {
    success: boolean;
    documents?: Document[];
    error?: string;
}
export declare class PDFExtractor {
    private readonly MIN_SECTIONS_FOR_SEMANTIC;
    extractFromPDF(filePath: string, config: PDFIngestorConfig): Promise<PDFExtractResult>;
    private extractWithHybridChunking;
    private detectHeadingSections;
    private chunkByPages;
    private createDocumentsFromSections;
    private formatAsMarkdown;
    private createMetadata;
    private countWords;
    private generateDocumentId;
}
//# sourceMappingURL=pdf-extractor.d.ts.map