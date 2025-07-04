import { Document } from '../types/index.js';
export interface FirecrawlConfig {
    apiKey?: string;
    apiUrl?: string;
    useLocalFirecrawl?: boolean;
    localFirecrawlUrl?: string;
    team_id: string;
    maxDepth?: number;
    maxPages?: number;
    excludePaths?: string[];
    includePaths?: string[];
    error?: string;
}
export interface FirecrawlExtractResult {
    success: boolean;
    document?: Document;
    error?: string;
}
export interface ExtractedContent {
    title: string;
    content: string;
    metadata: {
        url: string;
        timestamp: string;
        wordCount: number;
    };
}
interface ExtractionData {
    html?: string;
    markdown?: string;
    metadata?: Record<string, unknown>;
    success: boolean;
    error?: string;
}
export declare class FirecrawlExtractor {
    private app;
    private pdfExtractor;
    private config;
    private logger;
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
    private isGenericTitle;
    private extractTitleFromContent;
    private extractDate;
    private extractTags;
    private countWords;
    private extractDomain;
    private generateDocumentId;
    extractContent(url: string): Promise<ExtractedContent>;
    private fetchJson;
    private extractSubstack;
    scrapeUrl(url: string): Promise<ExtractionData>;
    private extractSubstackContent;
    extract(url: string): Promise<Document>;
}
export {};
//# sourceMappingURL=firecrawl-extractor.d.ts.map