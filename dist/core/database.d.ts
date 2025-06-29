import { CrawlJob } from '../types/index.js';
export declare class Database {
    private dbPath;
    private db;
    constructor(dbPath: string);
    init(): Promise<void>;
    addCrawlJob(job: Omit<CrawlJob, 'id' | 'created_at' | 'updated_at'>): Promise<CrawlJob>;
    updateCrawlJob(id: string, updates: Partial<Pick<CrawlJob, 'status' | 'retry_count' | 'error_message'>>): Promise<boolean>;
    getPendingJobs(limit?: number): Promise<CrawlJob[]>;
    getJobsByStatus(status: CrawlJob['status']): Promise<CrawlJob[]>;
    getJobById(id: string): Promise<CrawlJob | undefined>;
    getJobsByTeam(teamId: string): Promise<CrawlJob[]>;
    clearCompletedJobs(olderThanDays?: number): Promise<number>;
    getStats(): Promise<{
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    }>;
    private generateId;
}
//# sourceMappingURL=database.d.ts.map