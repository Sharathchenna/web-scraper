import { Document } from '../types/index.js';
export interface FirecrawlConfig {
    apiKey?: string;
    apiUrl?: string;
    useLocalFirecrawl?: boolean;
    localFirecrawlUrl?: string;
}
export interface FirecrawlExtractResult {
    success: boolean;
    document?: Document;
    error?: string;
}
export declare class FirecrawlExtractor {
    private config;
    private app;
    private pdfExtractor;
    constructor(config: FirecrawlConfig);
    extractFromUrl(url: string, teamId: string): Promise<FirecrawlExtractResult>;
    private preprocessUrl;
    private handleGoogleDriveUrl;
    private downloadPdf;
    private extractFromDownloadedPdf;
    private determineExtractionStrategy;
    crawlWebsite(url: string, teamId: string, options?: {
        limit?: number;
        excludePaths?: string[];
        includePaths?: string[];
        maxDepth?: number;
    }): Promise<{
        success: boolean;
        documents?: Document[];
        error?: string;
    }>;
    private createMetadata;
    private extractTitleFromContent;
    private extractDate;
    private extractTags;
    private countWords;
    private extractDomain;
    private generateDocumentId;
}
//# sourceMappingURL=firecrawl-extractor.d.ts.map