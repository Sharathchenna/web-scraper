import { AppConfig, Document, ProcessingStats } from '../types/index.js';
export interface CrawlWebsiteOptions {
    root_url: string;
    team_id: string;
    max_depth: number;
    max_pages: number;
    exclude_patterns: string[];
    include_patterns: string[];
}
export interface ProcessPDFOptions {
    file_path: string;
    team_id: string;
    chunk_by_pages: boolean;
    pages_per_chunk: number;
}
export interface ImportResult {
    success: boolean;
    documents?: Document[];
    error?: string;
    output_file?: string;
    stats?: ProcessingStats;
}
export declare class KnowledgeImporter {
    private config;
    private database;
    private firecrawlExtractor;
    private pdfExtractor;
    private chunker;
    private serializer;
    private workerPool;
    constructor(config: AppConfig);
    init(): Promise<void>;
    crawlWebsite(options: CrawlWebsiteOptions): Promise<ImportResult>;
    extractSingleUrl(url: string, teamId: string): Promise<ImportResult>;
    processPDF(options: ProcessPDFOptions): Promise<ImportResult>;
    getStats(teamId?: string): Promise<{
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    }>;
    cleanup(olderThanDays: number): Promise<number>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=knowledge-importer.d.ts.map