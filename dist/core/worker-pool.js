import pLimit from 'p-limit';
import { logger } from '../utils/logger.js';
export class WorkerPool {
    maxConcurrency;
    database;
    firecrawlExtractor;
    limit;
    isShuttingDown = false;
    activeJobs = new Set();
    constructor(maxConcurrency, database, firecrawlExtractor) {
        this.maxConcurrency = maxConcurrency;
        this.database = database;
        this.firecrawlExtractor = firecrawlExtractor;
        this.limit = pLimit(maxConcurrency);
        logger.info('Worker pool initialized', { maxConcurrency });
    }
    async processJob(job) {
        if (this.isShuttingDown) {
            throw new Error('Worker pool is shutting down');
        }
        const jobPromise = this.limit(async () => {
            return await this.executeJob(job);
        });
        this.activeJobs.add(jobPromise);
        try {
            const result = await jobPromise;
            return result;
        }
        finally {
            this.activeJobs.delete(jobPromise);
        }
    }
    async executeJob(job) {
        logger.debug('Starting job execution', { jobId: job.id, url: job.url });
        try {
            // Update job status to processing
            await this.database.updateCrawlJob(job.id, { status: 'processing' });
            // Extract content using Firecrawl
            const result = await this.firecrawlExtractor.extractFromUrl(job.url, job.team_id);
            if (result.success && result.document) {
                // Update job as completed
                await this.database.updateCrawlJob(job.id, { status: 'completed' });
                logger.info('Job completed successfully', {
                    jobId: job.id,
                    url: job.url,
                    title: result.document.title
                });
                return {
                    url: job.url,
                    success: true,
                    document: result.document,
                };
            }
            else {
                // Handle extraction failure
                const errorMessage = result.error || 'Unknown extraction error';
                await this.handleJobFailure(job, errorMessage);
                return {
                    url: job.url,
                    success: false,
                    error: errorMessage,
                };
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.handleJobFailure(job, errorMessage);
            logger.error('Job execution failed', {
                jobId: job.id,
                url: job.url,
                error: errorMessage
            });
            return {
                url: job.url,
                success: false,
                error: errorMessage,
            };
        }
    }
    async handleJobFailure(job, errorMessage) {
        const maxRetries = 3;
        const newRetryCount = job.retry_count + 1;
        if (newRetryCount < maxRetries) {
            // Retry the job
            await this.database.updateCrawlJob(job.id, {
                status: 'pending',
                retry_count: newRetryCount,
                error_message: errorMessage,
            });
            logger.warn('Job failed, will retry', {
                jobId: job.id,
                url: job.url,
                retryCount: newRetryCount,
                error: errorMessage
            });
            // Add exponential backoff delay before retry
            const delayMs = Math.min(1000 * Math.pow(2, newRetryCount), 30000); // Max 30 seconds
            setTimeout(async () => {
                try {
                    const retryJob = await this.database.getJobById(job.id);
                    if (retryJob && retryJob.status === 'pending') {
                        await this.processJob(retryJob);
                    }
                }
                catch (retryError) {
                    logger.error('Retry failed', {
                        jobId: job.id,
                        error: retryError instanceof Error ? retryError.message : 'Unknown error'
                    });
                }
            }, delayMs);
        }
        else {
            // Mark as permanently failed
            await this.database.updateCrawlJob(job.id, {
                status: 'failed',
                error_message: errorMessage,
            });
            logger.error('Job permanently failed after max retries', {
                jobId: job.id,
                url: job.url,
                finalError: errorMessage
            });
        }
    }
    async processPendingJobs() {
        if (this.isShuttingDown) {
            return;
        }
        try {
            const pendingJobs = await this.database.getPendingJobs(this.maxConcurrency * 2);
            if (pendingJobs.length === 0) {
                return;
            }
            logger.info('Processing pending jobs', { count: pendingJobs.length });
            const promises = pendingJobs.map(job => this.processJob(job));
            await Promise.allSettled(promises);
        }
        catch (error) {
            logger.error('Error processing pending jobs', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async startWorker() {
        logger.info('Starting worker pool');
        while (!this.isShuttingDown) {
            try {
                await this.processPendingJobs();
                // Wait before checking for more jobs
                await this.sleep(5000); // 5 seconds
            }
            catch (error) {
                logger.error('Worker error', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                // Wait longer on error to avoid rapid error loops
                await this.sleep(10000); // 10 seconds
            }
        }
        logger.info('Worker pool stopped');
    }
    async shutdown() {
        logger.info('Shutting down worker pool');
        this.isShuttingDown = true;
        // Wait for active jobs to complete
        if (this.activeJobs.size > 0) {
            logger.info('Waiting for active jobs to complete', { activeJobCount: this.activeJobs.size });
            await Promise.allSettled(Array.from(this.activeJobs));
        }
        logger.info('Worker pool shutdown complete');
    }
    getActiveJobCount() {
        return this.activeJobs.size;
    }
    getMaxConcurrency() {
        return this.maxConcurrency;
    }
    isActive() {
        return !this.isShuttingDown;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=worker-pool.js.map