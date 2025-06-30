import FirecrawlApp from '@mendable/firecrawl-js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { PDFExtractor } from './pdf-extractor.js';
import { chromium } from 'playwright';
import { createLogger } from '../utils/logger.js';
import { URL } from 'url';
export class FirecrawlExtractor {
    config;
    app;
    pdfExtractor;
    logger;
    constructor(config) {
        this.config = config;
        this.logger = createLogger();
        // Initialize Firecrawl with local or remote instance
        if (config.useLocalFirecrawl && config.localFirecrawlUrl) {
            this.app = new FirecrawlApp({
                apiUrl: config.localFirecrawlUrl,
                apiKey: 'dummy-key-for-local'
            });
        }
        else {
            this.app = new FirecrawlApp({ apiKey: config.apiKey || 'dummy-key' });
        }
        this.pdfExtractor = new PDFExtractor();
    }
    async extractFromUrl(url, teamId) {
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
            const responseData = scrapeResult;
            if (!responseData.markdown && !responseData.html) {
                const error = 'No content returned from Firecrawl';
                logger.error(error, { url, responseData: JSON.stringify(responseData, null, 2) });
                return { success: false, error };
            }
            // Extract metadata with enhanced title extraction
            let title = responseData.metadata?.title || responseData.metadata?.ogTitle;
            // Debug: log what we got from metadata
            logger.debug('Title extraction attempt', {
                url,
                metadataTitle: responseData.metadata?.title,
                ogTitle: responseData.metadata?.ogTitle,
                hasMarkdown: !!responseData.markdown,
                hasHtml: !!responseData.html
            });
            // If no title in metadata OR if it appears to be a generic site title, try extracting from content
            const shouldExtractFromContent = !title || (title && this.isGenericTitle(title, url));
            if (shouldExtractFromContent) {
                logger.debug('Generic or missing title detected, trying content extraction', {
                    originalTitle: title,
                    url,
                    reason: !title ? 'no_title' : 'generic_title'
                });
                // Try markdown content first
                if (responseData.markdown) {
                    const markdownTitle = this.extractTitleFromContent(responseData.markdown, url);
                    if (markdownTitle && !this.isGenericTitle(markdownTitle, url)) {
                        title = markdownTitle;
                        logger.debug('Extracted title from markdown', { title, url });
                    }
                }
                // If still no good title, try HTML content
                if ((!title || this.isGenericTitle(title, url)) && responseData.html) {
                    const htmlTitle = this.extractTitleFromContent(responseData.html, url);
                    if (htmlTitle && !this.isGenericTitle(htmlTitle, url)) {
                        title = htmlTitle;
                        logger.debug('Extracted title from HTML', { title, url });
                    }
                }
            }
            const author = responseData.metadata?.author || responseData.metadata?.ogSiteName;
            const datePublished = this.extractDate(responseData.metadata);
            // Create document
            const document = {
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
                strategy: extractionStrategy.name,
                hasMetadataTitle: !!responseData.metadata?.title,
                hasOgTitle: !!responseData.metadata?.ogTitle,
                hasMarkdown: !!responseData.markdown,
                hasHtml: !!responseData.html,
                extractedFromContent: !responseData.metadata?.title && !responseData.metadata?.ogTitle
            });
            return { success: true, document };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Advanced extraction error', { url, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
    async preprocessUrl(url) {
        // Handle Google Drive URLs
        if (url.includes('drive.google.com')) {
            return await this.handleGoogleDriveUrl(url);
        }
        // Handle direct PDF URLs
        if (url.endsWith('.pdf') || url.includes('.pdf')) {
            try {
                const filePath = await this.downloadPdf(url);
                return { url, isPdf: true, filePath };
            }
            catch (error) {
                logger.warn('Failed to download PDF, falling back to web scraping', { url, error });
                return { url };
            }
        }
        return { url };
    }
    async handleGoogleDriveUrl(url) {
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
        }
        catch (error) {
            logger.warn('Google Drive download failed, attempting web scraping fallback', { url, error });
            return { url };
        }
    }
    async downloadPdf(url, filename) {
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
    async extractFromDownloadedPdf(filePath, originalUrl, teamId) {
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
            }
            else {
                return { success: false, error: 'No document extracted from PDF' };
            }
            // Clean up temporary file
            try {
                fs.unlinkSync(filePath);
                logger.debug('Cleaned up temporary PDF file', { filePath });
            }
            catch (error) {
                logger.warn('Failed to clean up temporary file', { filePath, error });
            }
            return { success: true, document };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('PDF extraction error', { filePath, originalUrl, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
    determineExtractionStrategy(url) {
        const domain = new URL(url).hostname;
        if (domain.endsWith('substack.com')) {
            return { name: 'substack-json', options: {} };
        }
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
    async crawlWebsite(url, teamId, options = {}) {
        try {
            const crawlOptions = {
                limit: options.limit || 10,
                excludePaths: options.excludePaths || [],
                includePaths: options.includePaths || [],
                maxDepth: options.maxDepth || 2,
                scrapeOptions: {
                    formats: ['markdown', 'html'],
                    onlyMainContent: true,
                    waitFor: 1000,
                    timeout: 30000
                }
            };
            const crawlResult = await this.app.crawlUrl(url, crawlOptions);
            if (!crawlResult.success || !crawlResult.data) {
                const error = `Crawl failed: ${crawlResult.error || 'No data returned'}`;
                logger.error(error, { url });
                return { success: false, error };
            }
            const documents = [];
            for (const item of crawlResult.data) {
                let title = item.metadata?.title || item.metadata?.ogTitle || '';
                const itemUrl = (item.metadata?.sourceURL || url);
                // If no title in metadata OR if it appears to be a generic site title, try extracting from content
                const shouldExtractFromContent = !title || this.isGenericTitle(title, itemUrl);
                if (shouldExtractFromContent && item.markdown) {
                    const markdownTitle = this.extractTitleFromContent(item.markdown, itemUrl);
                    if (markdownTitle && !this.isGenericTitle(markdownTitle, itemUrl)) {
                        title = markdownTitle;
                    }
                }
                if ((!title || this.isGenericTitle(title, itemUrl)) && item.html) {
                    const htmlTitle = this.extractTitleFromContent(item.html, itemUrl);
                    if (htmlTitle && !this.isGenericTitle(htmlTitle, itemUrl)) {
                        title = htmlTitle;
                    }
                }
                const author = item.metadata?.author || item.metadata?.ogSiteName;
                const datePublished = this.extractDate(item.metadata);
                const document = {
                    id: this.generateDocumentId(itemUrl),
                    title: title || 'Untitled',
                    content: item.markdown || item.html || '',
                    content_type: 'markdown',
                    metadata: this.createMetadata(teamId, item, itemUrl),
                    date_scraped: new Date().toISOString()
                };
                if (itemUrl) {
                    document.source_url = itemUrl;
                }
                if (author) {
                    document.author = author;
                }
                if (datePublished) {
                    document.date_published = datePublished;
                }
                documents.push(document);
            }
            return { success: true, documents };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Crawl error', { url, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
    createMetadata(teamId, data, url) {
        const wordCount = data.html ? this.countWords(data.html) : 0;
        const metadata = {
            team_id: teamId,
            source_type: 'url',
            word_count: wordCount,
            reading_time_minutes: Math.ceil(wordCount / 200),
            domain: this.extractDomain(url),
            language: 'en'
        };
        if (data.metadata?.description) {
            metadata.description = data.metadata.description;
        }
        if (data.metadata?.tags) {
            metadata.tags = data.metadata.tags;
        }
        return metadata;
    }
    isGenericTitle(title, url) {
        if (!title)
            return true;
        // Extract domain for context
        const domain = this.extractDomain(url);
        const siteName = domain.split('.')[0]; // e.g., 'quill' from 'quill.co'
        // Common generic patterns
        const genericPatterns = [
            'untitled',
            'home',
            'homepage',
            'welcome',
            'main page',
            'index',
            'default',
            'loading',
            'page not found',
            '404',
            'error'
        ];
        const lowerTitle = title.toLowerCase();
        // Check if title is just the site name
        if (lowerTitle === siteName || lowerTitle === domain) {
            return true;
        }
        // Check against generic patterns
        if (genericPatterns.some(pattern => lowerTitle.includes(pattern))) {
            return true;
        }
        // Check if title appears to be a generic tagline (contains common business words)
        const businessKeywords = ['platform', 'solution', 'software', 'tool', 'service', 'api', 'dashboard', 'app', 'application'];
        const hasMultipleBusinessWords = businessKeywords.filter(keyword => lowerTitle.includes(keyword)).length >= 2;
        // If title is very long and contains multiple business keywords, likely a tagline
        if (title.length > 40 && hasMultipleBusinessWords) {
            return true;
        }
        // Check if title contains the site name and business keywords (likely a tagline)
        if (lowerTitle && siteName && lowerTitle.includes(siteName) && hasMultipleBusinessWords) {
            return true;
        }
        return false;
    }
    extractTitleFromContent(content, url) {
        // Extract domain info for context
        const domain = this.extractDomain(url);
        const siteName = domain.split('.')[0];
        // Dynamic skip patterns based on site context
        const commonNavigation = [
            'blog', 'product', 'docs', 'documentation', 'home', 'about', 'contact',
            'login', 'signup', 'sign up', 'register', 'pricing', 'features',
            'learn more', 'get started', 'book demo', 'try now', 'download',
            'support', 'help', 'careers', 'jobs', 'news', 'press'
        ];
        // Add site-specific patterns
        const skipPatterns = [
            ...commonNavigation,
            siteName,
            domain,
            `${siteName} ${siteName}`, // duplicate site names
            'want to learn more?',
            'book a demo',
            'get in touch'
        ];
        // Extract title from first H1 in markdown
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match && h1Match[1]) {
            const title = h1Match[1].trim();
            if (title && !this.isGenericTitle(title, url) && !skipPatterns.some(pattern => pattern && title.includes(pattern))) {
                return title;
            }
        }
        // Try to extract from HTML h1 tags
        const htmlH1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (htmlH1Match && htmlH1Match[1]) {
            const title = htmlH1Match[1].trim();
            if (title && !this.isGenericTitle(title, url) && !skipPatterns.some(pattern => pattern && title.includes(pattern))) {
                return title;
            }
        }
        // Look for content title patterns (often appear after navigation)
        // Pattern: lines that look like article/page titles (longer, descriptive)
        const lines = content.split('\n');
        for (let i = 0; i < Math.min(lines.length, 50); i++) {
            const line = lines[i]?.trim() || '';
            // Skip empty lines and markdown markers
            if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('[')) {
                continue;
            }
            // Skip navigation and common elements (case-insensitive)
            if (skipPatterns.some(pattern => pattern && line.toLowerCase().includes(pattern.toLowerCase()))) {
                continue;
            }
            // Skip lines with URLs, image paths, or technical content
            if (line.includes('http') || line.includes('.svg') || line.includes('.png') ||
                line.includes('.jpg') || line.includes('.gif') || line.includes('://')) {
                continue;
            }
            // Skip very short lines, separators, and formatting
            if (line.length < 15 || line.includes('===') || line.includes('---') ||
                line.includes('***') || line.includes('```')) {
                continue;
            }
            // Skip lines that are all caps (likely nav elements)
            if (line === line.toUpperCase() && line.length < 50) {
                continue;
            }
            // Skip common metadata patterns
            if (line.match(/^\w+ \d+, \d+$/) || line.includes('minute read') ||
                line.includes('min read') || line.match(/^\d+\s*(minute|min|hour|day)s?/i)) {
                continue;
            }
            // Skip author/byline patterns
            if (line.match(/^(by|author|written by)/i) || line.includes(' · ')) {
                continue;
            }
            // Look for article/page-like titles (reasonable length, contains letters, not too technical)
            if (line.length > 15 && line.length < 200 && /[a-zA-Z]/.test(line)) {
                // Should contain some common words (not just technical jargon)
                const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
                const hasCommonWords = commonWords.some(word => line.toLowerCase().includes(word));
                // Should look like a title (not a sentence with punctuation at the end)
                const looksLikeTitle = !line.endsWith('.') || line.endsWith('?') || line.endsWith('!');
                if (hasCommonWords && looksLikeTitle && !this.isGenericTitle(line, url)) {
                    return line;
                }
            }
        }
        // Look for markdown headers (##, ###, etc.) that might be the main title
        const anyHeaderMatch = content.match(/^#{2,6}\s+(.+)$/m);
        if (anyHeaderMatch && anyHeaderMatch[1]) {
            const title = anyHeaderMatch[1].trim();
            if (title && !this.isGenericTitle(title, url) && !skipPatterns.some(pattern => pattern && title.includes(pattern)) && title.length > 15) {
                return title;
            }
        }
        // Look for HTML headers (h2, h3, etc.)
        const anyHtmlHeaderMatch = content.match(/<h[2-6][^>]*>([^<]+)<\/h[2-6]>/i);
        if (anyHtmlHeaderMatch && anyHtmlHeaderMatch.length > 1 && anyHtmlHeaderMatch[1]) {
            const title = anyHtmlHeaderMatch[1].trim();
            if (title && !this.isGenericTitle(title, url) && !skipPatterns.some(pattern => pattern && title.includes(pattern)) && title.length > 15) {
                return title;
            }
        }
        return '';
    }
    extractDate(metadata) {
        if (!metadata)
            return undefined;
        // Try to get date from various metadata fields
        const dateFields = ['date', 'datePublished', 'publishedDate', 'created', 'createdAt'];
        for (const field of dateFields) {
            const value = metadata[field];
            if (typeof value === 'string' || value instanceof Date) {
                try {
                    const date = new Date(value);
                    return date.toISOString();
                }
                catch (e) {
                    this.logger.debug('Failed to parse date', { field, value });
                }
            }
        }
        return undefined;
    }
    extractTags(metadata) {
        if (!metadata)
            return [];
        const tags = [];
        const tagFields = ['tags', 'categories', 'keywords'];
        for (const field of tagFields) {
            const value = metadata[field];
            if (Array.isArray(value)) {
                tags.push(...value.filter((tag) => typeof tag === 'string'));
            }
            else if (typeof value === 'string') {
                tags.push(value);
            }
        }
        return tags;
    }
    countWords(text) {
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }
    extractDomain(url) {
        try {
            return new URL(url).hostname;
        }
        catch {
            return '';
        }
    }
    generateDocumentId(url) {
        // Create a deterministic ID based on URL
        const urlHash = Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
        return `doc_${urlHash}_${Date.now()}`;
    }
    async extractContent(url) {
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
            const links = await page.$$eval('div[style*="cursor:pointer"]', (elements) => {
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
            const content = links.map((link) => `Title: ${link.title || ''}\nDate: ${link.date || ''}\nDescription: ${link.description || ''}\n\n`).join('');
            return {
                title: 'Quill Blog',
                content,
                metadata: {
                    url,
                    timestamp: new Date().toISOString(),
                    wordCount: content.split(/\s+/).length
                }
            };
        }
        catch (error) {
            this.logger.error('Error extracting content:', error);
            throw error;
        }
        finally {
            await browser.close();
        }
    }
    async fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('paywalled');
            }
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        return response.json();
    }
    async extractSubstack(url) {
        try {
            const { hostname, pathname } = new URL(url);
            const slug = pathname.replace(/^\/p\/|\/$/, '');
            const apiUrl = `https://${hostname}/api/v1/posts/${slug}`;
            this.logger.info(`Fetching Substack post from ${apiUrl}`);
            const response = await fetch(apiUrl);
            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        metadata: {},
                        error: 'paywalled'
                    };
                }
                return {
                    success: false,
                    metadata: {},
                    error: `Failed to fetch post: ${response.statusText}`
                };
            }
            const json = await response.json();
            const metadata = {
                title: json.post.title,
                author: json.post.author?.name,
                date: json.post.published_at,
                description: json.post.subtitle,
                url: json.post.canonical_url,
                platform: 'substack'
            };
            if (json.post.tags?.length) {
                metadata.tags = json.post.tags.map(t => t.name);
            }
            if (json.post.audience) {
                metadata.audience = json.post.audience;
            }
            return {
                html: json.post.body_html,
                metadata,
                success: true
            };
        }
        catch (error) {
            this.logger.error(`Failed to extract Substack post: ${error}`);
            return {
                success: false,
                metadata: {},
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async scrapeUrl(url) {
        try {
            const strategy = this.determineExtractionStrategy(url);
            if (strategy.name === 'substack-json') {
                return this.extractSubstack(url);
            }
            // ... existing scraping code ...
            return { success: false }; // Default return for unhandled cases
        }
        catch (error) {
            this.logger.error(`Failed to scrape URL: ${error}`);
            return { success: false };
        }
    }
}
//# sourceMappingURL=firecrawl-extractor.js.map