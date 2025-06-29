import { Database } from './database.js';
import { FirecrawlExtractor } from '../processors/firecrawl-extractor.js';
import { PDFExtractor } from '../processors/pdf-extractor.js';
import { SemanticChunker } from '../processors/semantic-chunker.js';
import { KnowledgeBaseSerializer } from '../processors/knowledge-serializer.js';
import { WorkerPool } from './worker-pool.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
export class KnowledgeImporter {
    config;
    database;
    firecrawlExtractor;
    pdfExtractor;
    chunker;
    serializer;
    workerPool;
    constructor(config) {
        this.config = config;
        this.database = new Database(config.database_path);
        // Map old config to new FirecrawlExtractor config
        const firecrawlConfig = {
            useLocalFirecrawl: config.firecrawl.use_local,
        };
        if (config.firecrawl.api_key) {
            firecrawlConfig.apiKey = config.firecrawl.api_key;
        }
        if (config.firecrawl.api_url) {
            firecrawlConfig.apiUrl = config.firecrawl.api_url;
        }
        if (config.firecrawl.local_url) {
            firecrawlConfig.localFirecrawlUrl = config.firecrawl.local_url;
        }
        this.firecrawlExtractor = new FirecrawlExtractor(firecrawlConfig);
        this.pdfExtractor = new PDFExtractor();
        this.chunker = new SemanticChunker(config.chunking);
        this.serializer = new KnowledgeBaseSerializer(config.output_dir);
        this.workerPool = new WorkerPool(config.max_workers, this.database, this.firecrawlExtractor);
        // Ensure output directory exists
        if (!fs.existsSync(config.output_dir)) {
            fs.mkdirSync(config.output_dir, { recursive: true });
        }
    }
    async init() {
        await this.database.init();
        logger.info('Knowledge Importer initialized', {
            databasePath: this.config.database_path,
            outputDir: this.config.output_dir,
            maxWorkers: this.config.max_workers,
        });
    }
    async crawlWebsite(options) {
        const startTime = Date.now();
        try {
            logger.info('Starting website crawl', options);
            // Use Firecrawl's built-in crawling capability for better efficiency
            const crawlResult = await this.firecrawlExtractor.crawlWebsite(options.root_url, options.team_id, {
                limit: options.max_pages,
                excludePaths: options.exclude_patterns,
                includePaths: options.include_patterns,
                maxDepth: options.max_depth,
            });
            if (!crawlResult.success || !crawlResult.documents) {
                return {
                    success: false,
                    error: crawlResult.error || 'Unknown crawl error',
                };
            }
            const documents = crawlResult.documents;
            logger.info('Documents extracted, starting chunking process', {
                documentCount: documents.length,
            });
            // Process documents through chunker
            const chunkedDocuments = [];
            for (const doc of documents) {
                const chunked = await this.chunker.chunkDocument(doc);
                chunkedDocuments.push(chunked);
            }
            // Serialize to knowledge base format
            const outputFile = await this.serializer.serialize(chunkedDocuments, options.team_id);
            const processingTime = Date.now() - startTime;
            const stats = {
                total_pages: documents.length,
                successful_extractions: documents.length,
                failed_extractions: 0,
                total_chunks: chunkedDocuments.reduce((sum, doc) => sum + (doc.chunks?.length || 0), 0),
                processing_time_ms: processingTime,
            };
            logger.info('Website crawl completed successfully', {
                documentCount: documents.length,
                outputFile,
                processingTimeMs: processingTime,
            });
            return {
                success: true,
                documents: chunkedDocuments,
                output_file: outputFile,
                stats,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Website crawl failed', { error: errorMessage, options });
            return {
                success: false,
                error: errorMessage,
            };
        }
    }
    async extractSingleUrl(url, teamId) {
        const startTime = Date.now();
        try {
            logger.info('Starting enhanced single URL extraction', { url, teamId });
            // Use the enhanced single URL extraction with advanced strategies
            const extractResult = await this.firecrawlExtractor.extractFromUrl(url, teamId);
            if (!extractResult.success || !extractResult.document) {
                return {
                    success: false,
                    error: extractResult.error || 'Unknown extraction error',
                };
            }
            const document = extractResult.document;
            logger.info('Document extracted, starting chunking process', {
                title: document.title,
                wordCount: document.metadata.word_count,
            });
            // Process document through chunker
            const chunkedDocument = await this.chunker.chunkDocument(document);
            // Serialize to knowledge base format
            const outputFile = await this.serializer.serialize([chunkedDocument], teamId);
            const processingTime = Date.now() - startTime;
            const stats = {
                total_pages: 1,
                successful_extractions: 1,
                failed_extractions: 0,
                total_chunks: chunkedDocument.chunks?.length || 0,
                processing_time_ms: processingTime,
            };
            logger.info('Single URL extraction completed successfully', {
                title: document.title,
                outputFile,
                processingTimeMs: processingTime,
                chunks: chunkedDocument.chunks?.length || 0,
            });
            return {
                success: true,
                documents: [chunkedDocument],
                output_file: outputFile,
                stats,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Single URL extraction failed', { error: errorMessage, url, teamId });
            return {
                success: false,
                error: errorMessage,
            };
        }
    }
    async processPDF(options) {
        const startTime = Date.now();
        try {
            logger.info('Starting PDF processing', options);
            // Extract content from PDF
            const extractResult = await this.pdfExtractor.extractFromPDF(options.file_path, {
                team_id: options.team_id,
                max_depth: 1,
                max_pages: 1000,
                request_delay: 0,
                user_agent: 'Aline-Knowledge-Importer/1.0',
                output_dir: this.config.output_dir,
                file_path: options.file_path,
                chunk_by_pages: options.chunk_by_pages,
                pages_per_chunk: options.pages_per_chunk,
            });
            if (!extractResult.success || !extractResult.documents) {
                return {
                    success: false,
                    error: extractResult.error || 'Unknown PDF extraction error',
                };
            }
            const documents = extractResult.documents;
            logger.info('PDF content extracted, starting chunking process', {
                documentCount: documents.length,
            });
            // Process documents through chunker
            const chunkedDocuments = [];
            for (const doc of documents) {
                const chunked = await this.chunker.chunkDocument(doc);
                chunkedDocuments.push(chunked);
            }
            // Serialize to knowledge base format
            const outputFile = await this.serializer.serialize(chunkedDocuments, options.team_id);
            const processingTime = Date.now() - startTime;
            const stats = {
                total_pages: 1,
                successful_extractions: documents.length,
                failed_extractions: 0,
                total_chunks: chunkedDocuments.reduce((sum, doc) => sum + (doc.chunks?.length || 0), 0),
                processing_time_ms: processingTime,
            };
            logger.info('PDF processing completed successfully', {
                documentCount: documents.length,
                outputFile,
                processingTimeMs: processingTime,
            });
            return {
                success: true,
                documents: chunkedDocuments,
                output_file: outputFile,
                stats,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('PDF processing failed', { error: errorMessage, options });
            return {
                success: false,
                error: errorMessage,
            };
        }
    }
    async getStats(teamId) {
        if (teamId) {
            const jobs = await this.database.getJobsByTeam(teamId);
            return {
                total: jobs.length,
                pending: jobs.filter(j => j.status === 'pending').length,
                processing: jobs.filter(j => j.status === 'processing').length,
                completed: jobs.filter(j => j.status === 'completed').length,
                failed: jobs.filter(j => j.status === 'failed').length,
            };
        }
        return await this.database.getStats();
    }
    async cleanup(olderThanDays) {
        return await this.database.clearCompletedJobs(olderThanDays);
    }
    async shutdown() {
        logger.info('Shutting down Knowledge Importer');
        await this.workerPool.shutdown();
    }
}
//# sourceMappingURL=knowledge-importer.js.map