import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
export class Database {
    dbPath;
    db;
    constructor(dbPath) {
        this.dbPath = dbPath;
        // Ensure database directory exists
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        // Initialize lowdb
        const adapter = new JSONFile(dbPath);
        this.db = new Low(adapter, {
            crawl_jobs: [],
            meta: {
                created_at: new Date().toISOString(),
                version: '1.0.0',
            },
        });
    }
    async init() {
        await this.db.read();
        // Initialize with default data if file doesn't exist
        if (!this.db.data) {
            this.db.data = {
                crawl_jobs: [],
                meta: {
                    created_at: new Date().toISOString(),
                    version: '1.0.0',
                },
            };
            await this.db.write();
        }
    }
    async addCrawlJob(job) {
        await this.db.read();
        const newJob = {
            ...job,
            id: this.generateId(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        this.db.data.crawl_jobs.push(newJob);
        await this.db.write();
        logger.debug('Added crawl job', { jobId: newJob.id, url: newJob.url });
        return newJob;
    }
    async updateCrawlJob(id, updates) {
        await this.db.read();
        const jobIndex = this.db.data.crawl_jobs.findIndex(job => job.id === id);
        if (jobIndex === -1) {
            logger.warn('Crawl job not found for update', { jobId: id });
            return false;
        }
        const existingJob = this.db.data.crawl_jobs[jobIndex];
        if (!existingJob) {
            logger.warn('Crawl job not found during update', { jobId: id });
            return false;
        }
        this.db.data.crawl_jobs[jobIndex] = {
            id: existingJob.id,
            url: existingJob.url,
            status: updates.status ?? existingJob.status,
            retry_count: updates.retry_count ?? existingJob.retry_count,
            error_message: updates.error_message !== undefined ? updates.error_message : existingJob.error_message,
            created_at: existingJob.created_at,
            updated_at: new Date().toISOString(),
            team_id: existingJob.team_id,
            depth: existingJob.depth,
            parent_url: existingJob.parent_url,
        };
        await this.db.write();
        logger.debug('Updated crawl job', { jobId: id, updates });
        return true;
    }
    async getPendingJobs(limit = 10) {
        await this.db.read();
        return this.db.data.crawl_jobs
            .filter(job => job.status === 'pending')
            .slice(0, limit);
    }
    async getJobsByStatus(status) {
        await this.db.read();
        return this.db.data.crawl_jobs.filter(job => job.status === status);
    }
    async getJobById(id) {
        await this.db.read();
        return this.db.data.crawl_jobs.find(job => job.id === id);
    }
    async getJobsByTeam(teamId) {
        await this.db.read();
        return this.db.data.crawl_jobs.filter(job => job.team_id === teamId);
    }
    async clearCompletedJobs(olderThanDays = 7) {
        await this.db.read();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        const initialCount = this.db.data.crawl_jobs.length;
        this.db.data.crawl_jobs = this.db.data.crawl_jobs.filter(job => {
            if (job.status === 'completed' || job.status === 'failed') {
                const jobDate = new Date(job.updated_at);
                return jobDate > cutoffDate;
            }
            return true;
        });
        const removedCount = initialCount - this.db.data.crawl_jobs.length;
        if (removedCount > 0) {
            await this.db.write();
            logger.info('Cleared old completed jobs', { removedCount });
        }
        return removedCount;
    }
    async getStats() {
        await this.db.read();
        const jobs = this.db.data.crawl_jobs;
        return {
            total: jobs.length,
            pending: jobs.filter(j => j.status === 'pending').length,
            processing: jobs.filter(j => j.status === 'processing').length,
            completed: jobs.filter(j => j.status === 'completed').length,
            failed: jobs.filter(j => j.status === 'failed').length,
        };
    }
    generateId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
//# sourceMappingURL=database.js.map