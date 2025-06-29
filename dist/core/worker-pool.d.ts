import { Database } from './database.js';
import { FirecrawlExtractor } from '../processors/firecrawl-extractor.js';
import { CrawlJob, CrawlResult } from '../types/index.js';
export declare class WorkerPool {
    private maxConcurrency;
    private database;
    private firecrawlExtractor;
    private limit;
    private isShuttingDown;
    private activeJobs;
    constructor(maxConcurrency: number, database: Database, firecrawlExtractor: FirecrawlExtractor);
    processJob(job: CrawlJob): Promise<CrawlResult>;
    private executeJob;
    private handleJobFailure;
    processPendingJobs(): Promise<void>;
    startWorker(): Promise<void>;
    shutdown(): Promise<void>;
    getActiveJobCount(): number;
    getMaxConcurrency(): number;
    isActive(): boolean;
    private sleep;
}
//# sourceMappingURL=worker-pool.d.ts.map