import FirecrawlApp from '@mendable/firecrawl-js';
import { Document, DocumentMetadata } from '../types/index.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { PDFExtractor } from './pdf-extractor.js';
import { chromium, Page } from 'playwright';
import { Logger } from 'winston';
import { createLogger } from '../utils/logger.js';

export interface FirecrawlConfig {
  apiKey?: string;
  apiUrl?: string;
  useLocalFirecrawl?: boolean;
  localFirecrawlUrl?: string;
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

interface BlogPost {
  title: string | null;
  date: string | null;
  description: string | null;
}

export class FirecrawlExtractor {
  private app: FirecrawlApp;
  private pdfExtractor: PDFExtractor;
  private logger: Logger;

  constructor(private config: FirecrawlConfig) {
    this.logger = createLogger();
    // Initialize Firecrawl with local or remote instance
    if (config.useLocalFirecrawl && config.localFirecrawlUrl) {
      this.app = new FirecrawlApp({ 
        apiUrl: config.localFirecrawlUrl,
        apiKey: 'dummy-key-for-local'
      });
    } else {
      this.app = new FirecrawlApp({ apiKey: config.apiKey || 'dummy-key' });
    }
    
    this.pdfExtractor = new PDFExtractor();
  }

  async extractFromUrl(url: string, teamId: string): Promise<FirecrawlExtractResult> {
    try {
      logger.debug('Starting advanced URL extraction', { url });

      // Preprocess URL for special cases
      const processedUrl = await this.preprocessUrl(url);
      
      // Check if it's a PDF that was downloaded from Google Drive
      if (processedUrl.isPdf && processedUrl.filePath) {
        return await this.extractFromDownloadedPdf(processedUrl.filePath, url, teamId);
      }

      // Detect site type and apply appropriate strategy
      const extractionStrategy = this.determineExtractionStrategy(processedUrl.url);
      
      logger.debug('Using extraction strategy', { 
        originalUrl: url, 
        processedUrl: processedUrl.url, 
        strategy: extractionStrategy.name 
      });

      // Use the advanced extraction strategy
      const scrapeResult = await this.app.scrapeUrl(processedUrl.url, extractionStrategy.options);

      if (!scrapeResult.success) {
        const error = `Firecrawl extraction failed: ${scrapeResult.error}`;
        logger.error(error, { url });
        return { success: false, error };
      }

      // For scrapeUrl, data is directly in the response, not in a data array like crawlUrl
      const responseData = (scrapeResult as any);
      
      if (!responseData.markdown && !responseData.html) {
        const error = 'No content returned from Firecrawl';
        logger.error(error, { url, responseData: JSON.stringify(responseData, null, 2) });
        return { success: false, error };
      }

      // Extract metadata
      const title = responseData.metadata?.title || responseData.metadata?.ogTitle || this.extractTitleFromContent(responseData.markdown || '');
      const author = responseData.metadata?.author || responseData.metadata?.ogSiteName;
      const datePublished = this.extractDate(responseData.metadata);

      // Create document
      const document: Document = {
        id: this.generateDocumentId(url),
        title: title || 'Untitled',
        content: responseData.markdown || responseData.html || '',
        content_type: 'markdown',
        source_url: url,
        author,
        date_published: datePublished,
        date_scraped: new Date().toISOString(),
        metadata: this.createMetadata(teamId, responseData, url),
      };

      logger.info('Successfully extracted document', { 
        url, 
        title: document.title, 
        wordCount: document.metadata.word_count,
        strategy: extractionStrategy.name
      });

      return { success: true, document };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Advanced extraction error', { url, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async preprocessUrl(url: string): Promise<{ url: string; isPdf?: boolean; filePath?: string }> {
    // Handle Google Drive URLs
    if (url.includes('drive.google.com')) {
      return await this.handleGoogleDriveUrl(url);
    }

    // Handle direct PDF URLs
    if (url.endsWith('.pdf') || url.includes('.pdf')) {
      try {
        const filePath = await this.downloadPdf(url);
        return { url, isPdf: true, filePath };
      } catch (error) {
        logger.warn('Failed to download PDF, falling back to web scraping', { url, error });
        return { url };
      }
    }

    return { url };
  }

  private async handleGoogleDriveUrl(url: string): Promise<{ url: string; isPdf?: boolean; filePath?: string }> {
    try {
      logger.info('Processing Google Drive URL', { url });

      // Extract file ID from Google Drive URL
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!fileIdMatch) {
        throw new Error('Could not extract file ID from Google Drive URL');
      }

      const fileId = fileIdMatch[1];
      
      // Convert to direct download URL
      const directDownloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      
      logger.info('Attempting to download from Google Drive', { fileId, directDownloadUrl });

      // Try to download the file
      const filePath = await this.downloadPdf(directDownloadUrl, `google_drive_${fileId}.pdf`);
      
      return { 
        url: directDownloadUrl, 
        isPdf: true, 
        filePath 
      };

    } catch (error) {
      logger.warn('Google Drive download failed, attempting web scraping fallback', { url, error });
      return { url };
    }
  }

  private async downloadPdf(url: string, filename?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = filename || `downloaded_${Date.now()}.pdf`;
      const filePath = path.join(tempDir, fileName);

      const client = url.startsWith('https') ? https : http;
      
      const request = client.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            logger.info('Following redirect', { from: url, to: redirectUrl });
            this.downloadPdf(redirectUrl, filename).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          logger.info('PDF downloaded successfully', { filePath });
          resolve(filePath);
        });

        fileStream.on('error', (error) => {
          fs.unlinkSync(filePath);
          reject(error);
        });
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  private async extractFromDownloadedPdf(filePath: string, originalUrl: string, teamId: string): Promise<FirecrawlExtractResult> {
    try {
      logger.info('Extracting content from downloaded PDF', { filePath, originalUrl });

      const pdfConfig = {
        team_id: teamId,
        max_depth: 1,
        max_pages: 1,
        request_delay: 0,
        user_agent: 'Knowledge Importer PDF Processor',
        output_dir: './output',
        file_path: filePath,
        chunk_by_pages: false,
        pages_per_chunk: 5
      };
      
      const pdfResult = await this.pdfExtractor.extractFromPDF(filePath, pdfConfig);
      
      if (!pdfResult.success || !pdfResult.documents || pdfResult.documents.length === 0) {
        return { success: false, error: pdfResult.error || 'PDF extraction failed' };
      }

      // Get the first document and update source URL to original
      const document = pdfResult.documents[0];
      if (document) {
        document.source_url = originalUrl;
      } else {
        return { success: false, error: 'No document extracted from PDF' };
      }
      
      // Clean up temporary file
      try {
        fs.unlinkSync(filePath);
        logger.debug('Cleaned up temporary PDF file', { filePath });
      } catch (error) {
        logger.warn('Failed to clean up temporary file', { filePath, error });
      }

      return { success: true, document };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('PDF extraction error', { filePath, originalUrl, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private determineExtractionStrategy(url: string): { name: string; options: any } {
    const domain = this.extractDomain(url);
    
    // Modern SPA/React sites that need aggressive JavaScript rendering
    const heavyJSSites = [
      'medium.com', 'dev.to', 'hashnode.com', 'notion.so',
      'gitbook.io', 'vercel.com', 'netlify.com', 
      'github.com', 'gitlab.com', 'stackoverflow.com',
      'reddit.com', 'twitter.com', 'x.com',
      'youtube.com', 'vimeo.com', 'quill.co'
    ];

    // Documentation sites that usually work well with standard settings
    const docSites = [
      'docs.python.org', 'developer.mozilla.org', 'w3schools.com',
      'tensorflow.org', 'pytorch.org', 'reactjs.org'
    ];

    // Blog sites that work well with our improved settings
    // const blogSites = [
    //   'nilmamano.com', 'interviewing.io', 'blog.', 'substack.com'
    // ];

    if (heavyJSSites.some(site => domain.includes(site))) {
      return {
        name: 'heavy-javascript',
        options: {
          formats: ['markdown', 'html'],
          includeTags: ['title', 'meta', 'article', 'main', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'blockquote', 'ul', 'ol', 'li'],
          excludeTags: ['script', 'style', 'nav', 'footer', 'aside', 'header', 'noscript'],
          waitFor: 15000, // Wait 15 seconds for heavy JavaScript
          timeout: 45000, // 45 second timeout for complex sites
          onlyMainContent: true,
        }
      };
    }

    if (docSites.some(site => domain.includes(site))) {
      return {
        name: 'documentation',
        options: {
          formats: ['markdown', 'html'],
          includeTags: ['title', 'meta', 'article', 'main', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'table', 'tr', 'td', 'th'],
          excludeTags: ['script', 'style', 'nav', 'footer', 'aside', 'header'],
          waitFor: 5000, // Short wait for static docs
          timeout: 20000, // 20 second timeout
          onlyMainContent: true,
        }
      };
    }

    // Default strategy for blogs and standard sites
    return {
      name: 'standard-blog',
      options: {
        formats: ['markdown', 'html'],
        includeTags: ['title', 'meta', 'article', 'main', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code'],
        excludeTags: ['script', 'style', 'nav', 'footer', 'aside', 'header'],
        waitFor: 10000, // Wait 10 seconds for dynamic content
        timeout: 30000, // 30 second timeout
        onlyMainContent: true,
      }
    };
  }

  async crawlWebsite(
    url: string, 
    teamId: string, 
    options: {
      limit?: number;
      excludePaths?: string[];
      includePaths?: string[];
      maxDepth?: number;
    } = {}
  ): Promise<{
    success: boolean;
    documents?: Document[];
    error?: string;
  }> {
    try {
      logger.info('Starting website crawl', { url, options });

      // Enhanced crawl configuration for better link discovery across any website
      const crawlOptions: any = {
        limit: options.limit || 50,
        excludePaths: options.excludePaths || [],
        includePaths: options.includePaths || [],
        maxDepth: options.maxDepth || 3,
        scrapeOptions: {
          formats: ['markdown', 'html'],
          // Broader content capture for better link discovery
          onlyMainContent: false,
          // Wait longer for JavaScript-generated content and dynamic links
          waitFor: 8000,
          timeout: 45000,
        },
      };



      const crawlResult = await this.app.crawlUrl(url, crawlOptions);

      if (!crawlResult.success) {
        const error = `Firecrawl crawl failed: ${crawlResult.error}`;
        logger.error(error, { url });
        return { success: false, error };
      }

      const documents: Document[] = [];
      
      if (crawlResult.data) {
        for (const item of crawlResult.data) {
          if (item.markdown || item.html) {
            const title = item.metadata?.title || item.metadata?.ogTitle || this.extractTitleFromContent(item.markdown || '');
            const author = item.metadata?.author || item.metadata?.ogSiteName;
            const datePublished = this.extractDate(item.metadata);

            const document: Document = {
              id: this.generateDocumentId(item.metadata?.sourceURL || url),
              title: title || 'Untitled',
              content: item.markdown || item.html || '',
              content_type: 'markdown',
              source_url: item.metadata?.sourceURL || url,
              author,
              date_published: datePublished,
              date_scraped: new Date().toISOString(),
              metadata: this.createMetadata(teamId, item, item.metadata?.sourceURL || url),
            };

            documents.push(document);
          }
        }
      }

      logger.info('Successfully crawled website', { 
        url, 
        documentCount: documents.length 
      });

      return { success: true, documents };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Firecrawl crawl error', { url, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }



  private createMetadata(teamId: string, data: any, sourceUrl: string): DocumentMetadata {
    const content = data.markdown || data.html || '';
    const wordCount = this.countWords(content);
    
    return {
      team_id: teamId,
      source_type: 'blog',
      word_count: wordCount,
      reading_time_minutes: Math.max(1, Math.ceil(wordCount / 200)), // Assume 200 words per minute
      description: data.metadata?.description || data.metadata?.ogDescription,
      language: data.metadata?.language || 'en',
      domain: this.extractDomain(sourceUrl),
      tags: this.extractTags(data.metadata),
    };
  }

  private extractTitleFromContent(content: string): string {
    // Extract title from first H1 or first line
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      return h1Match[1].trim();
    }

    const firstLine = content.split('\n')[0]?.trim();
    return firstLine?.replace(/^#+\s*/, '') || '';
  }

  private extractDate(metadata: any): string | undefined {
    if (!metadata) return undefined;
    
    // Try various date fields
    const dateFields = ['publishedTime', 'publishDate', 'datePublished', 'ogDate', 'articlePublishedTime'];
    
    for (const field of dateFields) {
      if (metadata[field]) {
        return new Date(metadata[field]).toISOString();
      }
    }

    return undefined;
  }

  private extractTags(metadata: any): string[] {
    if (!metadata) return [];
    
    const tags: string[] = [];
    
    // Extract from keywords
    if (metadata.keywords) {
      if (typeof metadata.keywords === 'string') {
        tags.push(...metadata.keywords.split(',').map((k: string) => k.trim()));
      } else if (Array.isArray(metadata.keywords)) {
        tags.push(...metadata.keywords);
      }
    }

    // Extract from article tags
    if (metadata.articleTag && Array.isArray(metadata.articleTag)) {
      tags.push(...metadata.articleTag);
    }

    return tags.filter(tag => tag && tag.length > 0);
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  private generateDocumentId(url: string): string {
    // Create a deterministic ID based on URL
    const urlHash = Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
    return `doc_${urlHash}_${Date.now()}`;
  }

  async extractContent(url: string): Promise<ExtractedContent> {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    
    try {
      const page = await context.newPage();
      
      // Navigate to the page and wait for content to load
      await page.goto(url, { waitUntil: 'networkidle' });
      
      // Wait for blog post elements to be visible
      await page.waitForSelector('div[style*="cursor:pointer"]', { timeout: 10000 });
      
      // Extract all blog post links
      const links = await page.$$eval('div[style*="cursor:pointer"]', (elements: Element[]) => {
        return elements.map(element => {
          const titleElement = element.querySelector('h1');
          const title = titleElement ? titleElement.textContent : null;
          const dateElement = element.querySelector('h4.text-slate-500');
          const date = dateElement ? dateElement.textContent : null;
          const descriptionElement = element.querySelector('h4.text-slate-500.tracking-tight.py-\\[12px\\]');
          const description = descriptionElement ? descriptionElement.textContent : null;
          
          return {
            title,
            date,
            description
          };
        });
      });
      
      // Combine all content
      const content = links.map((link: BlogPost) => 
        `Title: ${link.title || ''}\nDate: ${link.date || ''}\nDescription: ${link.description || ''}\n\n`
      ).join('');
      
      return {
        title: 'Quill Blog',
        content,
        metadata: {
          url,
          timestamp: new Date().toISOString(),
          wordCount: content.split(/\s+/).length
        }
      };
      
    } catch (error) {
      this.logger.error('Error extracting content:', error);
      throw error;
    } finally {
      await browser.close();
    }
  }
} 