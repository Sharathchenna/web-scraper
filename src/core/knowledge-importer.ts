import { Database } from './database.js';
import { FirecrawlExtractor } from '../processors/firecrawl-extractor.js';
import { PDFExtractor } from '../processors/pdf-extractor.js';
import { SemanticChunker } from '../processors/semantic-chunker.js';
import { KnowledgeBaseSerializer } from '../processors/knowledge-serializer.js';
import { WorkerPool } from './worker-pool.js';
import { AppConfig, Document, ProcessingStats } from '../types/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import { SmartLinkDiscoverer } from '../processors/smart-link-discoverer.js';

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
  total_chunks?: number;
}

export interface ImportResult {
  success: boolean;
  documents?: Document[];
  error?: string;
  output_file?: string;
  stats?: ProcessingStats;
}

interface SmartDiscoveryResult {
  urls: string[];
  interactions: string[];
  success: boolean;
  durationMs: number;
}

export class KnowledgeImporter {
  private database: Database;
  private firecrawlExtractor: FirecrawlExtractor;
  private pdfExtractor: PDFExtractor;
  private chunker: SemanticChunker;
  private serializer: KnowledgeBaseSerializer;
  private workerPool: WorkerPool;
  private linkDiscoverer: SmartLinkDiscoverer;

  constructor(private config: AppConfig) {
    this.database = new Database(config.database_path);
    
    // Map old config to new FirecrawlExtractor config
    const firecrawlConfig: {
      apiKey?: string;
      apiUrl?: string;
      useLocalFirecrawl?: boolean;
      localFirecrawlUrl?: string;
    } = {
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
    this.linkDiscoverer = new SmartLinkDiscoverer(logger);

    // Ensure output directory exists
    if (!fs.existsSync(config.output_dir)) {
      fs.mkdirSync(config.output_dir, { recursive: true });
    }
  }

  async init(): Promise<void> {
    await this.database.init();
    logger.info('Knowledge Importer initialized', {
      databasePath: this.config.database_path,
      outputDir: this.config.output_dir,
      maxWorkers: this.config.max_workers,
    });
  }

  async crawlWebsite(options: CrawlWebsiteOptions): Promise<ImportResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting website crawl', options);

      // First attempt: Use Firecrawl's built-in crawling capability
      const crawlResult = await this.firecrawlExtractor.crawlWebsite(
        options.root_url,
        options.team_id,
        {
          limit: options.max_pages,
          excludePaths: options.exclude_patterns,
          includePaths: options.include_patterns,
          maxDepth: options.max_depth,
        }
      );

      if (!crawlResult.success || !crawlResult.documents) {
        return {
          success: false,
          error: crawlResult.error || 'Unknown crawl error',
        };
      }

      // Smart discovery: If we only got 1 page but expected more, try link extraction
      if (crawlResult.documents.length === 1 && options.max_pages > 1) {
        logger.info('Only 1 page captured, attempting smart link discovery');
        const firstDoc = crawlResult.documents[0];
        if (!firstDoc) {
          logger.error('First document is undefined');
          return { success: false, error: 'No valid documents found' };
        }
        const enhancedResult = await this.trySmartDiscovery(firstDoc, options, startTime);
        if (enhancedResult.success && enhancedResult.documents && enhancedResult.documents.length > 1) {
          logger.info('Smart discovery successful', { 
            originalPages: 1, 
            discoveredPages: enhancedResult.documents.length 
          });
          return enhancedResult;
        }
        logger.info('Smart discovery did not find additional pages, using original result');
      }

      const documents = crawlResult.documents;
      logger.info('Documents extracted, starting chunking process', {
        documentCount: documents.length,
      });

      // Process documents through chunker
      const chunkedDocuments: Document[] = [];
      for (const doc of documents) {
        const chunked = await this.chunker.chunkDocument(doc);
        chunkedDocuments.push(chunked);
      }

      // Serialize to knowledge base format
      const outputFile = await this.serializer.serialize(chunkedDocuments, options.team_id);

      const processingTime = Date.now() - startTime;
      const stats: ProcessingStats = {
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

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Website crawl failed', { error: errorMessage, options });
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async trySmartDiscovery(directoryDoc: Document, options: CrawlWebsiteOptions, startTime: number): Promise<ImportResult> {
    try {
      logger.info('Starting enhanced smart link discovery from directory page');
      
      // Use enhanced SmartLinkDiscoverer with JavaScript-heavy detection
      const discoveryResult = await this.linkDiscoverer.discover(options.root_url, 10);
      
      if (!discoveryResult.success || discoveryResult.urls.length === 0) {
        logger.info('Enhanced link discovery found no additional URLs', {
          durationMs: discoveryResult.durationMs,
          interactions: discoveryResult.interactions.length
        });
        return { success: false, error: 'No links found' };
      }

      logger.info('Enhanced link discovery completed', {
        urlsFound: discoveryResult.urls.length,
        durationMs: discoveryResult.durationMs,
        interactions: discoveryResult.interactions.length
      });

      const discoveredUrls = discoveryResult.urls;

      // Limit URLs based on max_pages (minus 1 for the directory page itself)
      const maxAdditionalPages = Math.max(0, options.max_pages - 1);
      const urlsToProcess = discoveredUrls.slice(0, maxAdditionalPages);
      
      logger.info('Discovered URLs for processing', { 
        totalDiscovered: discoveredUrls.length,
        willProcess: urlsToProcess.length,
        maxPages: options.max_pages
      });

      // Extract each discovered URL individually
      const allDocuments: Document[] = [directoryDoc]; // Include the directory page
      let successCount = 1; // Directory page counts as success
      let failCount = 0;

      for (let i = 0; i < urlsToProcess.length; i++) {
        const url = urlsToProcess[i];
        if (!url) continue;
        
        try {
          logger.info(`Processing discovered URL ${i + 1}/${urlsToProcess.length}`, { url });
          
          const result = await this.firecrawlExtractor.extractFromUrl(url, options.team_id);
        
        if (result.success && result.document) {
          allDocuments.push(result.document);
          successCount++;
          logger.info(`✅ Successfully extracted: ${result.document.title}`);
        } else {
          failCount++;
          logger.warn(`❌ Failed to extract: ${url} - ${result.error}`);
        }
        
        // Small delay to be respectful to the server
        if (i < urlsToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (error) {
        failCount++;
        logger.error(`Error extracting ${url}:`, error);
      }
    }

    // Process all documents through chunker
    logger.info('Processing discovered documents through chunker', { documentCount: allDocuments.length });
    
    const chunkedDocuments: Document[] = [];
    for (const doc of allDocuments) {
      const chunked = await this.chunker.chunkDocument(doc);
      chunkedDocuments.push(chunked);
    }

    // Serialize to knowledge base format
    const outputFile = await this.serializer.serialize(chunkedDocuments, options.team_id);

    const processingTime = Date.now() - startTime;
    const stats: ProcessingStats = {
      total_pages: allDocuments.length,
      successful_extractions: successCount,
      failed_extractions: failCount,
      total_chunks: chunkedDocuments.reduce((sum, doc) => sum + (doc.chunks?.length || 0), 0),
      processing_time_ms: processingTime,
    };

    logger.info('Smart discovery completed successfully', {
      documentCount: allDocuments.length,
      successfulExtractions: successCount,
      failedExtractions: failCount,
      outputFile,
      processingTimeMs: processingTime,
    });

    return {
      success: true,
      documents: chunkedDocuments,
      output_file: outputFile,
      stats,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Smart discovery failed', { error: errorMessage });
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

  private async extractLinksFromContent(content: string, baseUrl: string): Promise<string[]> {
    const urls: string[] = [];
    const baseHostname = new URL(baseUrl).hostname;
    const baseDomain = baseUrl.replace(/\/$/, ''); // Remove trailing slash for consistent comparison

    // Enhanced patterns for finding blog/content links
    const patterns = [
      // Standard HTML links with href
      /href=["']([^"']+)["']/g,
      // Markdown links [text](url)
      /\[([^\]]+)\]\(([^)]+)\)/g,
      // JSON-like structures with URLs (for SPAs)
      /"url":\s*"([^"]+)"/g,
      /"href":\s*"([^"]+)"/g,
      /"link":\s*"([^"]+)"/g,
      // Next.js/React router links
      /to=["']([^"']+)["']/g,
      // Plain URLs in text
      /https?:\/\/[^\s<>"'()]+/g,
    ];

    // Extract URLs using all patterns
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // For markdown links, use the URL part (index 2), otherwise use index 1
        const url = match[2] || match[1];
        if (url) {
          const fullUrl = this.normalizeUrl(url, baseUrl);
          if (fullUrl && fullUrl.includes(baseHostname) && !urls.includes(fullUrl)) {
            urls.push(fullUrl);
          }
        }
      }
    }

    // Advanced filtering for better content discovery
    const filteredUrls = urls.filter(url => {
      // Remove malformed URLs with extra characters
      if (url.match(/[)\]}>]$/)) return false;

      // Remove anchor links and query parameters
      if (url.includes('#') || url.includes('?')) return false;

      // Remove asset files
      if (url.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot|pdf|zip|mp4|mp3)$/i)) return false;

      // Remove API endpoints and technical paths
      if (url.match(/\/(api|_next|static|assets|public|dist|build|node_modules)\//)) return false;

      // Remove self-references
      if (url === baseUrl || url === baseDomain) return false;

      // Keep blog-like paths
      if (url.match(/\/(blog|article|post|news|content|guide|tutorial|docs?|documentation)\//i)) return true;

      // Keep paths that look like individual content (e.g., /some-title, /category/title)
      const path = url.replace(baseDomain, '');
      if (
        path.match(/^\/[a-z0-9-_]+$/i) || // Simple slug
        path.match(/^\/[a-z0-9-_]+\/[a-z0-9-_]+$/i) || // Category/slug
        path.match(/^\/\d{4}\/\d{2}\//) // Date-based URLs
      ) {
        return true;
      }

      // For blog directories, also look for any path that's not just navigation
      const blogKeywords = ['analytics', 'data', 'business', 'intelligence', 'embedded', 'modern', 'stack', 'customers', 'chatgpt', 'ai'];
      if (blogKeywords.some(keyword => url.toLowerCase().includes(keyword))) {
        return true;
      }

      return false;
    });

    return filteredUrls;
  }

  private async discoverBlogContent(content: string, baseUrl: string): Promise<string[]> {
    const urls: string[] = [];
    const baseDomain = baseUrl.replace(/\/$/, '');
    
    // Look for structured content patterns common in blogs
    const contentPatterns = [
      // Article titles that might be links (look for common blog patterns)
      /(?:href=["']([^"']*\/[a-z0-9-]+(?:-[a-z0-9]+)*\/?))["']/gi,
      // Next.js router links
      /(?:to=["']([^"']*\/[a-z0-9-]+(?:-[a-z0-9]+)*\/?))["']/gi,
      // URL patterns in JSON data
      /"(?:url|href|link|path)":\s*"([^"]*\/[a-z0-9-]+(?:-[a-z0-9]+)*\/?[^"]*)"/gi,
    ];

    for (const pattern of contentPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1];
        if (url) {
          const fullUrl = this.normalizeUrl(url, baseUrl);
          if (fullUrl && fullUrl.includes(new URL(baseUrl).hostname) && !urls.includes(fullUrl)) {
            // Additional validation for blog content URLs
            const path = fullUrl.replace(baseDomain, '');
            if (path.length > 1 && // Not just "/"
                !path.match(/\.(html?|php)$/i) && // Not file extensions
                path.match(/[a-z]/i) // Contains letters (not just numbers/symbols)
            ) {
              urls.push(fullUrl);
            }
          }
        }
      }
    }

    // Enhanced blog post title discovery for modern JS-heavy sites
    const blogPostTitles = this.extractBlogPostTitles(content);
    logger.info('Discovered blog post titles', { 
      titleCount: blogPostTitles.length,
      sampleTitles: blogPostTitles.slice(0, 5)
    });

    if (blogPostTitles.length > 0) {
      // Smart pattern detection: try a few patterns with the first title to find what works
      const firstTitle = blogPostTitles[0];
      if (!firstTitle) return urls;
      
      const workingPattern = await this.detectWorkingUrlPattern(firstTitle, baseDomain);
      
      if (workingPattern) {
        logger.info('Detected working URL pattern', { pattern: workingPattern });
        
        // Apply the working pattern to all titles
        for (const title of blogPostTitles) {
          const url = this.applyUrlPattern(title, baseDomain, workingPattern);
          if (url && !urls.includes(url)) {
            urls.push(url);
          }
        }
      } else {
        // Fallback: use a smaller set of most likely patterns
        logger.info('No working pattern detected, using fallback approach');
        for (const title of blogPostTitles.slice(0, 3)) { // Limit to 3 titles to avoid too many 404s
          const potentialUrls = this.generatePotentialUrls(title, baseDomain, true); // Limited set
          potentialUrls.forEach(url => {
            if (!urls.includes(url)) {
              urls.push(url);
            }
          });
        }
      }
    }

    return urls;
  }

  private async detectWorkingUrlPattern(testTitle: string, baseDomain: string): Promise<string | null> {
    const slug = this.titleToSlug(testTitle);
    if (!slug) return null;

    // Common blog URL patterns to test (most likely first)
    const patternsToTest = [
      'blog/:slug',
      ':slug',
      'blog/:slug/',
      ':slug/',
      'posts/:slug',
      'articles/:slug',
      'content/:slug',
    ];

    // Test each pattern with a simple HTTP request (just check if it doesn't return 404)
    for (const pattern of patternsToTest) {
      const testUrl = this.applyUrlPattern(testTitle, baseDomain, pattern);
      if (testUrl) {
        try {
          // Quick validation using Firecrawl (which we already have available)
          const testResult = await this.firecrawlExtractor.extractFromUrl(testUrl, 'pattern-test');
          
          // If we got content and it's not a 404 page, this pattern works
          if (testResult.success && 
              testResult.document && 
              !testResult.document.title?.includes('404') &&
              testResult.document.content.length > 200) {
            logger.info('Found working URL pattern', { pattern, testUrl, title: testResult.document.title });
            return pattern;
          }
        } catch (error) {
          // Continue to next pattern
          continue;
        }
      }
    }

    return null;
  }

  private applyUrlPattern(title: string, baseDomain: string, pattern: string): string | null {
    const slug = this.titleToSlug(title);
    if (!slug) return null;

    return `${baseDomain}/${pattern.replace(':slug', slug)}`;
  }

  private titleToSlug(title: string): string | null {
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    return slug.length >= 5 ? slug : null;
  }

  private extractBlogPostTitles(content: string): string[] {
    const titles: string[] = [];
    
    // Enhanced patterns for finding blog post titles
    const titlePatterns = [
      // Main headings (often blog post titles)
      /^([A-Z][^=\n]{10,100})$\n={3,}$/gm,
      /^([A-Z][^#\n]{10,100})$\n#{3,}$/gm,
      // HTML headings
      /<h[1-3][^>]*>([^<]{10,100})<\/h[1-3]>/gi,
      // Markdown headings with #
      /^#{1,3}\s+([^#\n]{10,100})$/gm,
      // Lines that look like titles (title case, reasonable length)
      /^([A-Z][a-z]*(?:\s+[A-Z][a-z]*){2,10})(?:\s*\?)?$/gm,
      // Lines followed by "Read more" (common blog pattern)
      /^([A-Z][^=\n]{10,100})\n.*Read more/gm,
      // Lines in quotes that might be titles
      /"([A-Z][^"]{10,100})"/g,
    ];

    for (const pattern of titlePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const title = match[1]?.trim();
        if (title && this.isValidBlogTitle(title) && !titles.includes(title)) {
          titles.push(title);
        }
      }
    }

    return titles;
  }

  private isValidBlogTitle(title: string): boolean {
    // Filter out navigation, metadata, etc.
    const invalidPatterns = [
      /^(Product|Docs|Jobs|Blog|Home|About|Contact|Privacy|Terms)$/i,
      /^(Read more|Continue reading|Learn more)$/i,
      /^(January|February|March|April|May|June|July|August|September|October|November|December)/i,
      /^\d+$/,
      /^[A-Z]{2,}$/, // All caps (likely navigation)
    ];

    if (invalidPatterns.some(pattern => pattern.test(title))) {
      return false;
    }

    // Valid titles should be reasonable length and contain common words
    return title.length >= 10 && 
           title.length <= 100 && 
           title.split(' ').length >= 3 &&
           /[a-z]/.test(title); // Contains lowercase letters
  }

  private generatePotentialUrls(title: string, baseDomain: string, limited: boolean = false): string[] {
    const urls: string[] = [];
    
    // Convert title to various slug formats
    const baseSlug = title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    if (baseSlug.length < 5) return urls;

    // Common blog URL patterns
    const patterns = [
      `${baseDomain}/blog/${baseSlug}`,
      `${baseDomain}/${baseSlug}`,
      `${baseDomain}/blog/${baseSlug}/`,
      `${baseDomain}/${baseSlug}/`,
      `${baseDomain}/post/${baseSlug}`,
      `${baseDomain}/article/${baseSlug}`,
      `${baseDomain}/content/${baseSlug}`,
    ];

    // Add date-based patterns if we can infer dates
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1]; // Current and last year
    
    for (const year of years) {
      for (let month = 1; month <= 12; month++) {
        const monthStr = month.toString().padStart(2, '0');
        patterns.push(`${baseDomain}/blog/${year}/${monthStr}/${baseSlug}`);
        patterns.push(`${baseDomain}/${year}/${monthStr}/${baseSlug}`);
      }
    }

    // Add shortened slug variants for very long titles
    if (baseSlug.length > 50) {
      const shortSlug = baseSlug.split('-').slice(0, 6).join('-');
      patterns.push(`${baseDomain}/blog/${shortSlug}`);
      patterns.push(`${baseDomain}/${shortSlug}`);
    }

    if (limited) {
      return urls.slice(0, 3); // Return only the first 3 URLs for limited set
    }

    return patterns;
  }

  private normalizeUrl(url: string, baseUrl: string): string | null {
    try {
      // Convert relative URLs to absolute
      if (url.startsWith('/')) {
        const base = new URL(baseUrl);
        return `${base.protocol}//${base.hostname}${url}`;
      } else if (url.startsWith('http')) {
        return url;
      } else {
        // Skip relative paths that don't start with /
        return null;
      }
    } catch {
      return null;
    }
  }

  async extractSingleUrl(url: string, teamId: string): Promise<ImportResult> {
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
      const stats: ProcessingStats = {
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

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Single URL extraction failed', { error: errorMessage, url, teamId });
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async processPDF(options: ProcessPDFOptions): Promise<ImportResult> {
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
        total_chunks: options.total_chunks || 0,
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
      const chunkedDocuments: Document[] = [];
      for (const doc of documents) {
        const chunked = await this.chunker.chunkDocument(doc, options.total_chunks);
        chunkedDocuments.push(chunked);
      }

      // Serialize to knowledge base format
      const outputFile = await this.serializer.serialize(chunkedDocuments, options.team_id);

      const processingTime = Date.now() - startTime;
      const stats: ProcessingStats = {
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

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('PDF processing failed', { error: errorMessage, options });
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async getStats(teamId?: string): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
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

  async cleanup(olderThanDays: number): Promise<number> {
    return await this.database.clearCompletedJobs(olderThanDays);
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Knowledge Importer');
    await this.workerPool.shutdown();
  }
} 