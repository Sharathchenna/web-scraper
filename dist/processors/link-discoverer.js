import { createLogger } from '../utils/logger.js';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';
export class LinkDiscoverer {
    logger;
    static MAX_HEADLESS_BROWSERS = 3;
    static FRESH_ONLY_DAYS = 365;
    static MAX_FEED_ITEMS = 200;
    static NETWORK_TIMEOUT = 30000; // 30 seconds
    static JS_HEAVY_THRESHOLD = 50; // Score threshold for JS-heavy detection
    xmlParser;
    // Common blog platforms and their URL patterns
    static PLATFORM_PATTERNS = {
        'medium.com': [
            { prefix: '/@', separator: '-', hasCategory: false, dateFormat: undefined },
            { prefix: '/p/', separator: '-', hasCategory: false, dateFormat: undefined }
        ],
        'dev.to': [
            { prefix: '/', separator: '-', hasCategory: true, dateFormat: undefined }
        ],
        'hashnode.dev': [
            { prefix: '/', separator: '-', hasCategory: false, dateFormat: undefined }
        ],
        'wordpress.com': [
            { prefix: '/', dateFormat: 'YYYY/MM/DD', separator: '-', hasCategory: true },
            { prefix: '/', separator: '-', hasCategory: true, dateFormat: undefined }
        ]
    };
    // Selectors for interactive elements that might reveal more content
    static INTERACTION_SELECTORS = {
        loadMore: [
            'button:has-text("Load more")',
            'button:has-text("Show more")',
            'button:has-text("Load more posts")',
            'button:has-text("More posts")',
            'a:has-text("Load more")',
            'a:has-text("Show more")',
            '[data-testid*="load"]',
            '[data-cy*="load"]',
            '.load-more',
            '.show-more',
            '.btn-load-more'
        ],
        readMore: [
            'a:has-text("Read more")',
            'a:has-text("Continue reading")',
            'a:has-text("Read full")',
            'button:has-text("Read more")',
            'button:has-text("Continue reading")',
            '.read-more',
            '.continue-reading',
            '[data-action="read-more"]'
        ],
        pagination: [
            'a:has-text("Next")',
            'button:has-text("Next")',
            'a:has-text("→")',
            'a:has-text("›")',
            '.pagination a',
            '.pager a',
            '[aria-label*="next"]',
            '[data-testid*="next"]'
        ],
        expandable: [
            '[data-testid*="expand"]',
            '[aria-expanded="false"]',
            '.expandable',
            '.collapsible',
            'details summary',
            '[data-toggle="collapse"]'
        ]
    };
    constructor(logger) {
        this.logger = logger || createLogger();
        this.xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });
    }
    /**
     * Detects if a website is JavaScript-heavy by analyzing various indicators
     */
    async detectJavaScriptHeaviness(url) {
        let score = 0;
        const indicators = [];
        try {
            // First, try a simple fetch to see static content
            const response = await fetch(url);
            const html = await response.text();
            const dom = new JSDOM(html);
            const document = dom.window.document;
            // Check for SPA frameworks
            const scripts = Array.from(document.querySelectorAll('script'));
            const scriptContent = scripts.map(s => s.textContent || '').join(' ');
            if (scriptContent.includes('React') || document.querySelector('[data-reactroot]')) {
                score += 25;
                indicators.push('React framework detected');
            }
            if (scriptContent.includes('Vue') || document.querySelector('[data-v-]')) {
                score += 25;
                indicators.push('Vue framework detected');
            }
            if (scriptContent.includes('Angular') || document.querySelector('[ng-]')) {
                score += 25;
                indicators.push('Angular framework detected');
            }
            if (scriptContent.includes('Next.js') || scriptContent.includes('__NEXT_DATA__')) {
                score += 20;
                indicators.push('Next.js detected');
            }
            // Check for minimal initial content
            const textContent = document.body.textContent || '';
            const linkCount = document.querySelectorAll('a[href]').length;
            if (textContent.length < 500) {
                score += 15;
                indicators.push('Minimal initial text content');
            }
            if (linkCount < 5) {
                score += 15;
                indicators.push('Few static links found');
            }
            // Check for loading indicators
            const loadingElements = [
                'loading', 'spinner', 'skeleton', 'placeholder',
                'data-loading', 'is-loading', 'loading-state'
            ];
            for (const selector of loadingElements) {
                if (document.querySelector(`[class*="${selector}"], [data-testid*="${selector}"]`)) {
                    score += 10;
                    indicators.push(`Loading indicator found: ${selector}`);
                    break;
                }
            }
            // Check for API endpoints or data fetching
            if (scriptContent.includes('fetch(') || scriptContent.includes('axios') || scriptContent.includes('XMLHttpRequest')) {
                score += 10;
                indicators.push('Dynamic data fetching detected');
            }
            // Check for virtual scrolling or infinite scroll
            if (scriptContent.includes('virtual') || scriptContent.includes('infinite') || scriptContent.includes('IntersectionObserver')) {
                score += 15;
                indicators.push('Virtual/infinite scrolling detected');
            }
            this.logger.info('JavaScript heaviness analysis', {
                url,
                score,
                threshold: LinkDiscoverer.JS_HEAVY_THRESHOLD,
                indicators
            });
            return {
                isHeavy: score >= LinkDiscoverer.JS_HEAVY_THRESHOLD,
                indicators,
                score
            };
        }
        catch (error) {
            this.logger.warn('Failed to analyze JavaScript heaviness, assuming heavy', { url, error });
            return {
                isHeavy: true,
                indicators: ['Analysis failed - assuming JavaScript-heavy'],
                score: 100
            };
        }
    }
    /**
     * Layer 1: Extract links from static HTML content using JSON-LD, OG tags, and custom attributes
     */
    async extractLinksFromContent(content) {
        const urls = new Set();
        // JSON-LD extraction
        const jsonLdRegex = /<script[^>]+type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
        const jsonLdMatches = content.matchAll(jsonLdRegex);
        for (const match of jsonLdMatches) {
            try {
                if (match[1]) {
                    const json = JSON.parse(match[1]);
                    if (json['@type'] === 'Article' || json['@type'] === 'BlogPosting') {
                        const possibleUrls = [json.url, json.mainEntityOfPage, json['@id']];
                        possibleUrls.forEach(url => {
                            if (url && typeof url === 'string')
                                urls.add(url);
                        });
                    }
                }
            }
            catch (e) {
                this.logger.warn('Failed to parse JSON-LD:', e);
            }
        }
        // OG tags extraction
        const ogUrlRegex = /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/g;
        const ogMatches = content.matchAll(ogUrlRegex);
        for (const match of ogMatches) {
            if (match[1]) {
                urls.add(match[1]);
            }
        }
        // Custom attributes extraction
        const customAttrRegex = /(?:data-href|data-url)="([^"]+)"|onclick="location\.href='([^']+)'"/g;
        const customMatches = content.matchAll(customAttrRegex);
        for (const match of customMatches) {
            const url = match[1] || match[2];
            if (url)
                urls.add(url);
        }
        return Array.from(urls);
    }
    /**
     * Layer 2: Probe for RSS, Atom, and Sitemap feeds
     */
    async probeFeedsAndSitemaps(baseUrl) {
        const urls = new Set();
        const commonPaths = [
            '/rss.xml', '/feed.xml', '/atom.xml', '/feed',
            '/rss', '/sitemap.xml', '/sitemap_index.xml',
            '/sitemap_news.xml', '/sitemap-posts.xml'
        ];
        const now = new Date();
        const oneYearAgo = new Date(now.setFullYear(now.getFullYear() - 1));
        for (const path of commonPaths) {
            try {
                const feedUrl = new URL(path, baseUrl).toString();
                const response = await fetch(feedUrl);
                if (!response.ok)
                    continue;
                const content = await response.text();
                const xml = this.xmlParser.parse(content);
                // Handle RSS feeds
                if (xml.rss?.channel?.item) {
                    const items = Array.isArray(xml.rss.channel.item)
                        ? xml.rss.channel.item
                        : [xml.rss.channel.item];
                    for (const item of items.slice(0, LinkDiscoverer.MAX_FEED_ITEMS)) {
                        if (item.link) {
                            // Check publication date if available
                            if (item.pubDate) {
                                const pubDate = new Date(item.pubDate);
                                if (pubDate < oneYearAgo)
                                    continue;
                            }
                            urls.add(item.link);
                        }
                    }
                }
                // Handle Atom feeds
                if (xml.feed?.entry) {
                    const entries = Array.isArray(xml.feed.entry)
                        ? xml.feed.entry
                        : [xml.feed.entry];
                    for (const entry of entries.slice(0, LinkDiscoverer.MAX_FEED_ITEMS)) {
                        if (entry.link?.['@_href']) {
                            // Check publication date if available
                            if (entry.published || entry.updated) {
                                const pubDate = new Date(entry.published || entry.updated);
                                if (pubDate < oneYearAgo)
                                    continue;
                            }
                            urls.add(entry.link['@_href']);
                        }
                    }
                }
                // Handle Sitemaps
                if (xml.urlset?.url) {
                    const urlEntries = Array.isArray(xml.urlset.url)
                        ? xml.urlset.url
                        : [xml.urlset.url];
                    for (const entry of urlEntries.slice(0, LinkDiscoverer.MAX_FEED_ITEMS)) {
                        if (entry.loc) {
                            // Check lastmod if available
                            if (entry.lastmod) {
                                const lastMod = new Date(entry.lastmod);
                                if (lastMod < oneYearAgo)
                                    continue;
                            }
                            urls.add(entry.loc);
                        }
                    }
                }
            }
            catch (e) {
                this.logger.warn(`Failed to fetch/parse ${path}:`, e);
                continue;
            }
        }
        return Array.from(urls);
    }
    /**
     * Enhanced headless browser interactions for JavaScript-heavy sites
     */
    async performAdvancedInteractions(page, baseUrl) {
        const discoveredUrls = new Set();
        const interactionsPerformed = [];
        try {
            // Wait for initial page load
            await page.waitForLoadState('networkidle', { timeout: 10000 });
            await page.waitForTimeout(2000); // Additional wait for dynamic content
            // Phase 1: Try expanding/revealing hidden content
            for (const [interactionType, selectors] of Object.entries(LinkDiscoverer.INTERACTION_SELECTORS)) {
                for (const selector of selectors) {
                    try {
                        const elements = await page.$$(selector);
                        for (let i = 0; i < Math.min(elements.length, 3); i++) { // Limit to first 3 elements
                            const element = elements[i];
                            if (!element)
                                continue;
                            // Check if element is visible and clickable
                            const isVisible = await element.isVisible();
                            if (!isVisible)
                                continue;
                            this.logger.debug(`Attempting to click ${interactionType} element`, { selector, index: i });
                            // Scroll element into view and click
                            await element.scrollIntoViewIfNeeded();
                            await element.click();
                            interactionsPerformed.push(`Clicked ${interactionType}: ${selector}`);
                            // Wait for content to load
                            await page.waitForTimeout(1500);
                            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
                            // Extract any new URLs that appeared
                            const newUrls = await this.extractUrlsFromPage(page);
                            newUrls.forEach(url => {
                                if (this.isArticleUrl(url, baseUrl)) {
                                    discoveredUrls.add(url);
                                }
                            });
                        }
                    }
                    catch (error) {
                        // Continue with next selector if this one fails
                        this.logger.debug(`Failed to interact with ${selector}:`, error);
                    }
                }
            }
            // Phase 2: Infinite scroll simulation
            let scrollAttempts = 0;
            const maxScrollAttempts = 5;
            let previousHeight = await page.evaluate(() => document.body.scrollHeight);
            while (scrollAttempts < maxScrollAttempts) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(2000);
                const currentHeight = await page.evaluate(() => document.body.scrollHeight);
                if (currentHeight === previousHeight) {
                    break; // No more content loaded
                }
                previousHeight = currentHeight;
                scrollAttempts++;
                interactionsPerformed.push(`Infinite scroll attempt ${scrollAttempts}`);
                // Extract URLs from newly loaded content
                const scrollUrls = await this.extractUrlsFromPage(page);
                scrollUrls.forEach(url => {
                    if (this.isArticleUrl(url, baseUrl)) {
                        discoveredUrls.add(url);
                    }
                });
            }
            // Phase 3: Look for and interact with pagination
            const paginationSelectors = [
                'a[aria-label*="next" i]',
                'button[aria-label*="next" i]',
                '.pagination a:not(.disabled)',
                '.pager a:not(.disabled)',
                'a:has-text("Next")',
                'button:has-text("Next")'
            ];
            for (const selector of paginationSelectors) {
                try {
                    const paginationElement = await page.$(selector);
                    if (paginationElement && await paginationElement.isVisible()) {
                        const href = await paginationElement.getAttribute('href');
                        if (href) {
                            // Navigate to next page
                            await page.goto(new URL(href, baseUrl).toString());
                            await page.waitForLoadState('networkidle', { timeout: 10000 });
                            interactionsPerformed.push(`Navigated to pagination: ${href}`);
                            // Extract URLs from the new page
                            const pageUrls = await this.extractUrlsFromPage(page);
                            pageUrls.forEach(url => {
                                if (this.isArticleUrl(url, baseUrl)) {
                                    discoveredUrls.add(url);
                                }
                            });
                            break; // Only try first successful pagination
                        }
                    }
                }
                catch (error) {
                    this.logger.debug(`Pagination interaction failed for ${selector}:`, error);
                }
            }
            // Phase 4: Try common AJAX loading patterns
            try {
                // Look for elements that might trigger AJAX loading
                const ajaxTriggers = [
                    '[data-load-more]',
                    '[data-infinite-scroll]',
                    '[data-ajax-load]',
                    '.js-load-more',
                    '.infinite-scroll-trigger'
                ];
                for (const trigger of ajaxTriggers) {
                    const element = await page.$(trigger);
                    if (element && await element.isVisible()) {
                        await element.scrollIntoViewIfNeeded();
                        await element.click();
                        await page.waitForTimeout(2000);
                        interactionsPerformed.push(`Triggered AJAX loading: ${trigger}`);
                        const ajaxUrls = await this.extractUrlsFromPage(page);
                        ajaxUrls.forEach(url => {
                            if (this.isArticleUrl(url, baseUrl)) {
                                discoveredUrls.add(url);
                            }
                        });
                    }
                }
            }
            catch (error) {
                this.logger.debug('AJAX trigger interaction failed:', error);
            }
            this.logger.info('Advanced interactions completed', {
                urlsFound: discoveredUrls.size,
                interactions: interactionsPerformed.length
            });
            return {
                urls: Array.from(discoveredUrls),
                interactionsPerformed,
                success: discoveredUrls.size > 0
            };
        }
        catch (error) {
            this.logger.error('Advanced interactions failed:', error);
            return {
                urls: Array.from(discoveredUrls),
                interactionsPerformed,
                success: false
            };
        }
    }
    /**
     * Layer 4: Analyze network requests to discover hidden article URLs
     */
    async sniffNetworkRequests(baseUrl) {
        const urls = new Set();
        const browser = await chromium.launch();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });
        try {
            const page = await context.newPage();
            const requests = [];
            // Intercept network requests
            await page.route('**/*', async (route) => {
                const request = route.request();
                const requestData = {
                    url: request.url(),
                    method: request.method()
                };
                const postData = request.postData();
                if (postData) {
                    requestData.postData = postData;
                }
                try {
                    const response = await route.fetch();
                    const body = await response.text();
                    requestData.response = {
                        status: response.status(),
                        body
                    };
                }
                catch (e) {
                    // Ignore failed requests
                }
                requests.push(requestData);
                await route.continue();
            });
            // Navigate and wait for network idle
            await page.goto(baseUrl, {
                waitUntil: 'networkidle',
                timeout: LinkDiscoverer.NETWORK_TIMEOUT
            });
            // Scroll to trigger lazy loading
            await page.evaluate(() => {
                return new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });
            // Wait for any new requests to settle
            await page.waitForLoadState('networkidle');
            // Analyze requests and responses
            for (const request of requests) {
                // Skip non-GET requests and non-200 responses
                if (request.method !== 'GET' || request.response?.status !== 200)
                    continue;
                // Check if the request URL might be an article
                if (this.looksLikeArticleUrl(request.url)) {
                    urls.add(request.url);
                    continue;
                }
                // Look for article URLs in JSON responses
                if (request.response?.body && request.response.body.startsWith('{')) {
                    try {
                        const json = JSON.parse(request.response.body);
                        this.extractUrlsFromJson(json, Array.from(urls));
                    }
                    catch (e) {
                        // Ignore invalid JSON
                    }
                }
                // Look for article URLs in HTML responses
                if (request.response?.body && request.response.body.includes('<')) {
                    const extractedUrls = await this.extractLinksFromContent(request.response.body);
                    extractedUrls.forEach(url => urls.add(url));
                }
            }
        }
        catch (e) {
            this.logger.error('Network sniffing failed:', e);
        }
        finally {
            await browser.close();
        }
        return Array.from(urls);
    }
    /**
     * Check if a URL looks like it might be an article
     */
    looksLikeArticleUrl(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;
            // Skip obvious non-article URLs
            if (path.match(/\.(jpg|jpeg|png|gif|css|js|woff2?)$/i))
                return false;
            if (path.match(/^\/api\/|^\/static\/|^\/assets\//))
                return false;
            // Check for common article URL patterns
            const hasSlug = path.match(/[a-z0-9](-[a-z0-9]+)+$/i);
            const hasDate = path.match(/\d{4}\/\d{2}\/\d{2}/);
            const hasCommonPath = path.match(/\/(post|article|blog|story)\//i);
            return !!(hasSlug || hasDate || hasCommonPath);
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Extract URLs from JSON-LD data
     */
    extractUrlsFromJson(data, urlFields) {
        const urls = [];
        if (typeof data === 'object' && data !== null) {
            for (const field of urlFields) {
                const value = data[field];
                if (typeof value === 'string') {
                    urls.push(value);
                }
            }
            // Recursively search through arrays and objects
            for (const value of Object.values(data)) {
                if (Array.isArray(value)) {
                    for (const item of value) {
                        urls.push(...this.extractUrlsFromJson(item, urlFields));
                    }
                }
                else if (typeof value === 'object' && value !== null) {
                    urls.push(...this.extractUrlsFromJson(value, urlFields));
                }
            }
        }
        return urls;
    }
    /**
     * Checks if a URL is likely to be an article URL
     */
    isArticleUrl(url, baseUrl) {
        try {
            const urlObj = new URL(url, baseUrl);
            const path = urlObj.pathname.toLowerCase();
            // Common article URL patterns
            const articlePatterns = [
                /\/blog\//,
                /\/article\//,
                /\/post\//,
                /\/news\//,
                /\/\d{4}\/\d{2}\//, // Date-based URLs
                /\/p\//, // Medium-style
                /\/@[\w-]+\// // Author-based URLs
            ];
            return articlePatterns.some(pattern => pattern.test(path));
        }
        catch {
            return false;
        }
    }
    /**
     * Extract URLs from HTML content
     */
    extractUrlsFromHtml(html, baseUrl) {
        const discoveredUrls = [];
        const dom = new JSDOM(html);
        const document = dom.window.document;
        // Extract URLs from various elements
        const elements = document.querySelectorAll('a[href], link[rel="canonical"], meta[property="og:url"]');
        elements.forEach((element) => {
            const href = element.getAttribute('href') || element.getAttribute('content');
            if (href) {
                try {
                    const absoluteUrl = new URL(href, baseUrl).toString();
                    if (this.isArticleUrl(absoluteUrl, baseUrl)) {
                        discoveredUrls.push(absoluteUrl);
                    }
                }
                catch {
                    // Ignore invalid URLs
                }
            }
        });
        // Extract URLs from JSON-LD scripts
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        scripts.forEach((element) => {
            if (element instanceof HTMLScriptElement) {
                try {
                    const data = JSON.parse(element.textContent || '');
                    const extractedUrls = this.extractUrlsFromJson(data, ['url', '@id', 'mainEntityOfPage']);
                    extractedUrls.forEach(url => {
                        if (this.isArticleUrl(url, baseUrl)) {
                            discoveredUrls.push(url);
                        }
                    });
                }
                catch {
                    // Ignore invalid JSON
                }
            }
        });
        return Array.from(new Set(discoveredUrls));
    }
    /**
     * Helper method to extract URLs from the current page state
     */
    async extractUrlsFromPage(page) {
        const discoveredUrls = [];
        // Extract URLs from various elements
        const elements = await page.$$('a[href], link[rel="canonical"], meta[property="og:url"]');
        for (const element of elements) {
            try {
                const href = await element.getAttribute('href');
                if (href) {
                    discoveredUrls.push(href);
                }
            }
            catch (error) {
                // Ignore errors for individual elements
            }
        }
        // Extract URLs from JSON-LD scripts
        const jsonLdScripts = await page.$$('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const content = await script.textContent();
                if (content) {
                    const data = JSON.parse(content);
                    const extractedUrls = this.extractUrlsFromJson(data, ['url', '@id', 'mainEntityOfPage']);
                    discoveredUrls.push(...extractedUrls);
                }
            }
            catch (error) {
                // Ignore errors for individual scripts
            }
        }
        return Array.from(new Set(discoveredUrls));
    }
    /**
     * Layer 5: Headless Browser Simulation
     * Simulates user interactions like clicking "Load More" buttons and infinite scroll
     */
    async simulateUserBehavior(page, directoryUrl) {
        const urls = new Set();
        try {
            // Wait for initial content load
            await page.waitForLoadState('networkidle');
            // Wait for any "Read more" links to appear
            await page.waitForSelector('a:has-text("Read more")', { timeout: 5000 }).catch(() => { });
            // Get all article links
            const articleLinks = await page.$$eval('a', (links) => {
                return links
                    .filter(link => {
                    const href = link.getAttribute('href');
                    // Look for links that match blog post patterns
                    return href && (href.includes('/blog/') ||
                        link.textContent?.toLowerCase().includes('read more') ||
                        link.closest('article') !== null);
                })
                    .map(link => link.getAttribute('href'))
                    .filter(href => href !== null);
            });
            // Add discovered URLs
            articleLinks.forEach(url => urls.add(url));
            // Try clicking "Load more" or pagination buttons if they exist
            const loadMoreButton = await page.$('button:has-text("Load more")');
            if (loadMoreButton) {
                await loadMoreButton.click();
                await page.waitForLoadState('networkidle');
                // Get additional article links after loading more
                const moreLinks = await page.$$eval('a', (links) => {
                    return links
                        .filter(link => {
                        const href = link.getAttribute('href');
                        return href && (href.includes('/blog/') ||
                            link.textContent?.toLowerCase().includes('read more') ||
                            link.closest('article') !== null);
                    })
                        .map(link => link.getAttribute('href'))
                        .filter(href => href !== null);
                });
                moreLinks.forEach(url => urls.add(url));
            }
            // Try infinite scroll simulation
            let previousHeight = 0;
            let scrollAttempts = 0;
            const maxScrollAttempts = 5;
            while (scrollAttempts < maxScrollAttempts) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1000);
                const currentHeight = await page.evaluate(() => document.body.scrollHeight);
                if (currentHeight === previousHeight) {
                    break;
                }
                previousHeight = currentHeight;
                scrollAttempts++;
                // Get any new links that appeared after scrolling
                const newLinks = await page.$$eval('a', (links) => {
                    return links
                        .filter(link => {
                        const href = link.getAttribute('href');
                        return href && (href.includes('/blog/') ||
                            link.textContent?.toLowerCase().includes('read more') ||
                            link.closest('article') !== null);
                    })
                        .map(link => link.getAttribute('href'))
                        .filter(href => href !== null);
                });
                newLinks.forEach(url => urls.add(url));
            }
        }
        catch (error) {
            this.logger.error('Error during user behavior simulation:', error);
        }
        return Array.from(urls);
    }
    /**
     * Main entry point for discovering hidden links with JavaScript-heavy site detection
     */
    async discoverLinks(directoryUrl) {
        let discoveredUrls = [];
        let currentLayer = 1;
        let interactionsPerformed = [];
        this.logger.info('Starting link discovery with JS-heavy detection', { url: directoryUrl });
        // Step 0: Detect if the site is JavaScript-heavy
        const jsHeavinessCheck = await this.detectJavaScriptHeaviness(directoryUrl);
        if (jsHeavinessCheck.isHeavy) {
            this.logger.info('JavaScript-heavy site detected, using advanced browser interactions', {
                score: jsHeavinessCheck.score,
                indicators: jsHeavinessCheck.indicators
            });
            // For JS-heavy sites, go straight to advanced browser interactions
            currentLayer = 5;
            try {
                const browser = await chromium.launch({ headless: true });
                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport: { width: 1280, height: 720 }
                });
                const page = await context.newPage();
                await page.goto(directoryUrl, { waitUntil: 'networkidle', timeout: 30000 });
                // Use advanced interactions for JS-heavy sites
                const interactionResult = await this.performAdvancedInteractions(page, directoryUrl);
                discoveredUrls = interactionResult.urls;
                interactionsPerformed = interactionResult.interactionsPerformed;
                await browser.close();
                this.logger.info('Advanced interactions completed', {
                    urlsFound: discoveredUrls.length,
                    interactions: interactionsPerformed.length
                });
            }
            catch (error) {
                if (error instanceof Error) {
                    this.logger.error('Advanced browser interactions failed:', error);
                }
                // Fall back to traditional methods if browser interactions fail
            }
        }
        // If not JS-heavy or if browser interactions didn't find enough URLs, use traditional methods
        if (!jsHeavinessCheck.isHeavy || discoveredUrls.length < 2) {
            this.logger.info('Using traditional extraction methods', {
                jsHeavy: jsHeavinessCheck.isHeavy,
                currentUrlCount: discoveredUrls.length
            });
            // Layer 1 - Static HTML extraction
            if (discoveredUrls.length < 2) {
                currentLayer = Math.max(currentLayer, 1);
                try {
                    const response = await fetch(directoryUrl);
                    const html = await response.text();
                    const staticUrls = this.extractUrlsFromHtml(html, directoryUrl);
                    const uniqueUrls = new Set([...discoveredUrls, ...staticUrls]);
                    discoveredUrls = Array.from(uniqueUrls);
                    this.logger.debug('Layer 1 completed', { urlsFound: staticUrls.length });
                }
                catch (error) {
                    if (error instanceof Error) {
                        this.logger.error('Layer 1 failed:', error);
                    }
                }
            }
            // Layer 2 - RSS/Sitemap probe
            if (discoveredUrls.length < 2) {
                currentLayer = Math.max(currentLayer, 2);
                try {
                    const feedUrls = await this.probeFeedsAndSitemaps(directoryUrl);
                    const uniqueUrls = new Set([...discoveredUrls, ...feedUrls]);
                    discoveredUrls = Array.from(uniqueUrls);
                    this.logger.debug('Layer 2 completed', { urlsFound: feedUrls.length });
                }
                catch (error) {
                    if (error instanceof Error) {
                        this.logger.error('Layer 2 failed:', error);
                    }
                }
            }
            // Layer 3 - Network request analysis
            if (discoveredUrls.length < 2) {
                currentLayer = Math.max(currentLayer, 3);
                try {
                    const networkUrls = await this.sniffNetworkRequests(directoryUrl);
                    const uniqueUrls = new Set([...discoveredUrls, ...networkUrls]);
                    discoveredUrls = Array.from(uniqueUrls);
                    this.logger.debug('Layer 3 completed', { urlsFound: networkUrls.length });
                }
                catch (error) {
                    if (error instanceof Error) {
                        this.logger.error('Layer 3 failed:', error);
                    }
                }
            }
            // Layer 4 - Basic Browser Simulation (only if not already done with advanced interactions)
            if (discoveredUrls.length < 2 && !jsHeavinessCheck.isHeavy) {
                currentLayer = Math.max(currentLayer, 4);
                try {
                    const browser = await chromium.launch({ headless: true });
                    const context = await browser.newContext();
                    const page = await context.newPage();
                    await page.goto(directoryUrl);
                    const simulatedUrls = await this.simulateUserBehavior(page, directoryUrl);
                    const uniqueUrls = new Set([...discoveredUrls, ...simulatedUrls]);
                    discoveredUrls = Array.from(uniqueUrls);
                    await browser.close();
                    this.logger.debug('Layer 4 completed', { urlsFound: simulatedUrls.length });
                }
                catch (error) {
                    if (error instanceof Error) {
                        this.logger.error('Layer 4 failed:', error);
                    }
                }
            }
        }
        const result = {
            urls: discoveredUrls,
            layer: currentLayer,
            success: discoveredUrls.length >= 1, // Lower threshold for success
            jsHeavy: jsHeavinessCheck.isHeavy
        };
        if (interactionsPerformed.length > 0) {
            result.interactionsPerformed = interactionsPerformed;
        }
        this.logger.info('Link discovery completed', {
            totalUrls: discoveredUrls.length,
            layer: currentLayer,
            jsHeavy: jsHeavinessCheck.isHeavy,
            success: result.success,
            interactions: interactionsPerformed.length
        });
        return result;
    }
}
//# sourceMappingURL=link-discoverer.js.map