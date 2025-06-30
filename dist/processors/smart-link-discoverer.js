import { createLogger } from '../utils/logger.js';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';
export class SmartLinkDiscoverer {
    logger;
    xmlParser;
    // Configuration constants
    static JS_HEAVY_THRESHOLD = 50;
    static MAX_SCROLL_ATTEMPTS = 5;
    static MAX_CLICK_ATTEMPTS = 3;
    static INTERACTION_TIMEOUT = 2000;
    static NETWORK_TIMEOUT = 30000;
    // Selector groups for different interaction types
    static INTERACTION_SELECTORS = {
        loadMore: [
            'button:has-text("load more")',
            'button:has-text("show more")',
            'button:has-text("load more posts")',
            'button:has-text("view more")',
            'a:has-text("load more")',
            'a:has-text("show more")',
            '.load-more',
            '.show-more',
            '.btn-load-more',
            '.view-more',
            '[data-testid*="load"]',
            '[data-cy*="load"]',
            '[data-action*="load"]'
        ],
        readMore: [
            // Primary selectors for "Read more" text - most common pattern
            'a:has-text("Read more")',
            'button:has-text("Read more")',
            'a:has-text("read more")',
            'button:has-text("read more")',
            'a:has-text("continue reading")',
            'a:has-text("read full")',
            'button:has-text("continue reading")',
            // CSS class selectors
            '.read-more',
            '.continue-reading',
            '.read-full',
            '.read-more-link',
            '.post-read-more',
            // Data attribute selectors
            '[data-action="read-more"]',
            '[data-testid*="read"]',
            '[data-cy*="read"]',
            // Generic link selectors within article/post containers
            'article a[href*="blog"]',
            '.post a[href*="blog"]',
            '.article a[href*="blog"]',
            // Fallback: any link that contains blog-like paths
            'a[href*="/blog/"]',
            'a[href*="/post/"]',
            'a[href*="/article/"]'
        ],
        pagination: [
            'a[aria-label*="next" i]',
            'button[aria-label*="next" i]',
            'a:has-text("Next")',
            'button:has-text("Next")',
            'a:has-text("→")',
            'a:has-text("›")',
            '.pagination a:not(.disabled)',
            '.pager a:not(.disabled)',
            '[data-testid*="next"]',
            '[aria-label*="next"]'
        ],
        expandable: [
            '[data-testid*="expand"]',
            '[aria-expanded="false"]',
            '.expandable',
            '.collapsible',
            'details summary',
            '[data-toggle="collapse"]',
            '.accordion-toggle'
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
     * STEP 1: Quick probe to determine if site is JavaScript-heavy (≤1s)
     */
    async quickProbe(url) {
        let score = 0;
        const indicators = [];
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(5000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const html = await response.text();
            const dom = new JSDOM(html);
            const document = dom.window.document;
            // Score based on content sparsity
            const textContent = document.body?.textContent || '';
            const wordCount = textContent.split(/\s+/).filter(word => word.length > 0).length;
            if (wordCount < 500) {
                score += 15;
                indicators.push(`Low word count: ${wordCount}`);
            }
            // Score based on link density
            const anchorCount = document.querySelectorAll('a[href]').length;
            if (anchorCount < 5) {
                score += 15;
                indicators.push(`Few static links: ${anchorCount}`);
            }
            // Check for JavaScript frameworks and patterns
            const scripts = Array.from(document.querySelectorAll('script'));
            const scriptContent = scripts.map(s => s.textContent || '').join(' ');
            const htmlContent = html.toLowerCase();
            // Framework detection
            if (scriptContent.includes('React') || htmlContent.includes('data-reactroot') || htmlContent.includes('_next')) {
                score += 20;
                indicators.push('React/Next.js detected');
            }
            if (scriptContent.includes('Vue') || htmlContent.includes('data-v-')) {
                score += 20;
                indicators.push('Vue.js detected');
            }
            if (scriptContent.includes('Angular') || htmlContent.includes('ng-')) {
                score += 20;
                indicators.push('Angular detected');
            }
            if (scriptContent.includes('__NEXT_DATA__') || htmlContent.includes('_next/static')) {
                score += 20;
                indicators.push('Next.js detected');
            }
            // Dynamic data fetching indicators
            if (scriptContent.includes('fetch(') || scriptContent.includes('axios') || scriptContent.includes('XMLHttpRequest')) {
                score += 20;
                indicators.push('Dynamic data fetching detected');
            }
            // Loading/spinner indicators
            const loadingClasses = ['loading', 'spinner', 'skeleton', 'placeholder'];
            for (const className of loadingClasses) {
                if (htmlContent.includes(className)) {
                    score += 10;
                    indicators.push(`Loading indicator: ${className}`);
                    break;
                }
            }
            // Preload indicators for SPA
            const preloadLinks = document.querySelectorAll('link[rel="preload"]');
            if (preloadLinks.length > 0) {
                for (const link of preloadLinks) {
                    const href = link.getAttribute('href') || '';
                    if (href.includes('_next/') || href.includes('static/')) {
                        score += 10;
                        indicators.push('SPA preload detected');
                        break;
                    }
                }
            }
            this.logger.debug('Quick probe completed', {
                url,
                score,
                threshold: SmartLinkDiscoverer.JS_HEAVY_THRESHOLD,
                indicators
            });
            return {
                isJSHeavy: score >= SmartLinkDiscoverer.JS_HEAVY_THRESHOLD,
                score,
                indicators
            };
        }
        catch (error) {
            this.logger.warn('Quick probe failed, assuming JS-heavy', { url, error });
            return {
                isJSHeavy: true,
                score: 100,
                indicators: ['Probe failed - assuming JS-heavy']
            };
        }
    }
    /**
     * STEP 2: Cheap methods (static scraping, feeds)
     */
    async cheapMethods(url) {
        const discoveredUrls = new Set();
        // Method A: Static HTML scraping
        try {
            const response = await fetch(url);
            const html = await response.text();
            const staticUrls = this.extractStaticLinks(html, url);
            staticUrls.forEach(url => discoveredUrls.add(url));
            this.logger.debug('Static scraping completed', { urlsFound: staticUrls.length });
        }
        catch (error) {
            this.logger.debug('Static scraping failed', { error });
        }
        // Method B: RSS/Sitemap probing
        try {
            const feedUrls = await this.probeFeedsAndSitemaps(url);
            feedUrls.forEach(url => discoveredUrls.add(url));
            this.logger.debug('Feed probing completed', { urlsFound: feedUrls.length });
        }
        catch (error) {
            this.logger.debug('Feed probing failed', { error });
        }
        return Array.from(discoveredUrls);
    }
    /**
     * STEP 3: Headless Playwright mode with smart interactions
     */
    async playwrightMode(url) {
        const discoveredUrls = new Set();
        const interactions = [];
        const stats = {
            buttonsClicked: 0,
            scrollAttempts: 0,
            urlsFound: 0,
            networkRequests: 0
        };
        let browser = null;
        let context = null;
        let page = null;
        try {
            // Launch browser with optimized settings
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                javaScriptEnabled: true
            });
            page = await context.newPage();
            // Enhanced network monitoring for navigation and content discovery
            page.on('request', (request) => {
                stats.networkRequests++;
                const requestUrl = request.url();
                // Capture blog post URLs from navigation requests
                if (this.looksLikeArticleUrl(requestUrl, url)) {
                    discoveredUrls.add(requestUrl);
                    interactions.push(`Network request: ${requestUrl}`);
                    this.logger.debug(`📡 Captured navigation URL: ${requestUrl}`);
                }
            });
            page.on('response', async (response) => {
                const responseUrl = response.url();
                // Capture blog post URLs from responses (including redirects)
                if (response.status() === 200 && this.looksLikeArticleUrl(responseUrl, url)) {
                    discoveredUrls.add(responseUrl);
                    interactions.push(`Response URL: ${responseUrl}`);
                    this.logger.debug(`📥 Captured response URL: ${responseUrl}`);
                }
                // Also check for JSON responses that might contain URLs
                if (response.status() === 200 && response.url().includes('json')) {
                    try {
                        const text = await response.text();
                        if (text.startsWith('{') || text.startsWith('[')) {
                            const urls = this.extractUrlsFromJson(JSON.parse(text));
                            urls.forEach(extractedUrl => {
                                if (this.looksLikeArticleUrl(extractedUrl, url)) {
                                    discoveredUrls.add(extractedUrl);
                                    interactions.push(`JSON URL: ${extractedUrl}`);
                                }
                            });
                        }
                    }
                    catch (e) {
                        // Ignore JSON parse errors
                    }
                }
            });
            // Monitor frame navigation events
            page.on('framenavigated', (frame) => {
                if (page && frame === page.mainFrame()) {
                    const frameUrl = frame.url();
                    if (this.looksLikeArticleUrl(frameUrl, url)) {
                        discoveredUrls.add(frameUrl);
                        interactions.push(`Frame navigation: ${frameUrl}`);
                        this.logger.debug(`🔄 Captured frame navigation: ${frameUrl}`);
                    }
                }
            });
            // Navigate and wait for initial load
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: SmartLinkDiscoverer.NETWORK_TIMEOUT
            });
            await page.waitForTimeout(2000); // Let lazy JS initialize
            // Phase A: Click revealer buttons
            const buttonResults = await this.clickRevealerButtons(page, url);
            buttonResults.urls.forEach(url => discoveredUrls.add(url));
            buttonResults.interactions.forEach(interaction => interactions.push(interaction));
            stats.buttonsClicked = buttonResults.buttonsClicked;
            // Phase B: Infinite scroll
            const scrollResults = await this.performInfiniteScroll(page, url);
            scrollResults.urls.forEach(url => discoveredUrls.add(url));
            scrollResults.interactions.forEach(interaction => interactions.push(interaction));
            stats.scrollAttempts = scrollResults.scrollAttempts;
            // Final harvest of all URLs on page
            const finalUrls = await this.harvestAllUrls(page, url);
            finalUrls.forEach(url => discoveredUrls.add(url));
            stats.urlsFound = discoveredUrls.size;
        }
        catch (error) {
            this.logger.error('Playwright mode failed', { error });
        }
        finally {
            if (page)
                await page.close().catch(() => { });
            if (context)
                await context.close().catch(() => { });
            if (browser)
                await browser.close().catch(() => { });
        }
        return {
            urls: Array.from(discoveredUrls),
            interactions,
            stats
        };
    }
    /**
     * PROVEN STRATEGY: Rapid-click all "Read more" buttons to capture navigation URLs
     */
    async clickRevealerButtons(page, baseUrl) {
        const discoveredUrls = new Set();
        const interactions = [];
        let buttonsClicked = 0;
        // First harvest any existing URLs before clicking
        const initialUrls = await this.harvestAllUrls(page, baseUrl);
        initialUrls.forEach(url => discoveredUrls.add(url));
        // PROVEN STRATEGY: Focus on "Read more" buttons with rapid-click approach
        try {
            // Find all "Read more" buttons at once
            let readMoreButtons = await page.locator('button:has-text("Read more")').all();
            this.logger.debug(`Found ${readMoreButtons.length} "Read more" buttons`);
            if (readMoreButtons.length === 0) {
                // Try alternative selectors
                const altButtons = await page.locator('button').filter({ hasText: /read more/i }).all();
                readMoreButtons = [...readMoreButtons, ...altButtons];
            }
            interactions.push(`Found ${readMoreButtons.length} "Read more" buttons`);
            // Click each button rapidly and capture navigation URLs
            for (let i = 0; i < readMoreButtons.length; i++) {
                try {
                    const button = readMoreButtons[i];
                    if (!button)
                        continue;
                    const originalUrl = page.url();
                    this.logger.debug(`Clicking button ${i + 1}/${readMoreButtons.length}`);
                    // Click the button
                    await button.click();
                    buttonsClicked++;
                    // Brief wait to capture the network request/navigation
                    await page.waitForTimeout(800);
                    // Check if we navigated to a new page
                    const currentUrl = page.url();
                    if (currentUrl !== originalUrl && this.looksLikeArticleUrl(currentUrl, baseUrl)) {
                        discoveredUrls.add(currentUrl);
                        interactions.push(`Navigation click ${i + 1}: ${currentUrl}`);
                        // Go back to continue with other buttons
                        await page.goBack();
                        await page.waitForLoadState('networkidle', { timeout: 3000 });
                    }
                }
                catch (clickError) {
                    this.logger.debug(`Button ${i + 1} click failed`, { error: clickError });
                    interactions.push(`Button ${i + 1} click failed: ${clickError instanceof Error ? clickError.message : 'Unknown error'}`);
                }
            }
            // If no buttons worked, try other interaction types as fallback
            if (discoveredUrls.size <= initialUrls.length) {
                const otherSelectors = [
                    'a:has-text("Read more")',
                    'a[href*="/blog/"]',
                    'article a[href]',
                    '.post a[href]'
                ];
                for (const selector of otherSelectors) {
                    try {
                        const elements = await page.$$(selector);
                        this.logger.debug(`Trying fallback selector: ${selector}, found ${elements.length} elements`);
                        for (let i = 0; i < Math.min(elements.length, 5); i++) {
                            const element = elements[i];
                            if (!element)
                                continue;
                            const href = await element.getAttribute('href').catch(() => null);
                            if (href) {
                                const absoluteUrl = new URL(href, baseUrl).toString();
                                if (this.looksLikeArticleUrl(absoluteUrl, baseUrl)) {
                                    discoveredUrls.add(absoluteUrl);
                                    interactions.push(`Fallback link: ${absoluteUrl}`);
                                }
                            }
                        }
                    }
                    catch (e) {
                        // Continue with next selector
                    }
                }
            }
        }
        catch (error) {
            this.logger.error('Rapid click strategy failed', { error });
            interactions.push(`Rapid click strategy error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        return {
            urls: Array.from(discoveredUrls),
            interactions,
            buttonsClicked
        };
    }
    /**
     * Perform systematic infinite scroll
     */
    async performInfiniteScroll(page, baseUrl) {
        const discoveredUrls = new Set();
        const interactions = [];
        let scrollAttempts = 0;
        let previousHeight = await page.evaluate(() => document.body.scrollHeight);
        while (scrollAttempts < SmartLinkDiscoverer.MAX_SCROLL_ATTEMPTS) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1500);
            const currentHeight = await page.evaluate(() => document.body.scrollHeight);
            scrollAttempts++;
            interactions.push(`Infinite scroll attempt #${scrollAttempts}`);
            if (currentHeight === previousHeight) {
                this.logger.debug('No new content after scroll, stopping');
                break;
            }
            previousHeight = currentHeight;
            // Harvest URLs after each scroll
            const newUrls = await this.harvestAllUrls(page, baseUrl);
            newUrls.forEach(url => discoveredUrls.add(url));
        }
        return {
            urls: Array.from(discoveredUrls),
            interactions,
            scrollAttempts
        };
    }
    /**
     * Extract all URLs from current page state
     */
    async harvestAllUrls(page, baseUrl) {
        try {
            const urls = await page.$$eval('a[href]', (links, base) => {
                return links
                    .map(link => {
                    try {
                        const href = link.href;
                        return new URL(href, base).toString();
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(href => href !== null);
            }, baseUrl);
            return urls.filter(url => this.looksLikeArticleUrl(url, baseUrl));
        }
        catch (error) {
            this.logger.debug('URL harvesting failed', { error });
            return [];
        }
    }
    /**
     * Helper methods
     */
    extractStaticLinks(html, baseUrl) {
        const urls = new Set();
        const dom = new JSDOM(html);
        const document = dom.window.document;
        // Extract from links
        const links = document.querySelectorAll('a[href]');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                try {
                    const absoluteUrl = new URL(href, baseUrl).toString();
                    if (this.looksLikeArticleUrl(absoluteUrl, baseUrl)) {
                        urls.add(absoluteUrl);
                    }
                }
                catch {
                    // Ignore invalid URLs
                }
            }
        });
        return Array.from(urls);
    }
    async probeFeedsAndSitemaps(baseUrl) {
        const urls = new Set();
        const feedPaths = [
            '/rss.xml', '/feed.xml', '/atom.xml', '/feed',
            '/rss', '/sitemap.xml', '/sitemap_index.xml'
        ];
        for (const path of feedPaths) {
            try {
                const feedUrl = new URL(path, baseUrl).toString();
                const response = await fetch(feedUrl, { signal: AbortSignal.timeout(5000) });
                if (response.ok) {
                    const content = await response.text();
                    const xml = this.xmlParser.parse(content);
                    // Parse RSS/Atom/Sitemap and extract URLs
                    this.extractUrlsFromXML(xml).forEach(url => urls.add(url));
                }
            }
            catch {
                // Ignore feed errors
            }
        }
        return Array.from(urls);
    }
    extractUrlsFromXML(xml) {
        const urls = [];
        // RSS
        if (xml.rss?.channel?.item) {
            const items = Array.isArray(xml.rss.channel.item) ? xml.rss.channel.item : [xml.rss.channel.item];
            items.forEach((item) => {
                if (item.link)
                    urls.push(item.link);
            });
        }
        // Atom
        if (xml.feed?.entry) {
            const entries = Array.isArray(xml.feed.entry) ? xml.feed.entry : [xml.feed.entry];
            entries.forEach((entry) => {
                if (entry.link?.['@_href'])
                    urls.push(entry.link['@_href']);
            });
        }
        // Sitemap
        if (xml.urlset?.url) {
            const urlEntries = Array.isArray(xml.urlset.url) ? xml.urlset.url : [xml.urlset.url];
            urlEntries.forEach((entry) => {
                if (entry.loc)
                    urls.push(entry.loc);
            });
        }
        return urls;
    }
    extractUrlsFromJson(data, fields = ['url', 'href', 'link', '@id']) {
        const urls = [];
        if (typeof data === 'object' && data !== null) {
            if (Array.isArray(data)) {
                data.forEach(item => urls.push(...this.extractUrlsFromJson(item, fields)));
            }
            else {
                fields.forEach(field => {
                    if (typeof data[field] === 'string') {
                        urls.push(data[field]);
                    }
                });
                Object.values(data).forEach(value => {
                    if (typeof value === 'object') {
                        urls.push(...this.extractUrlsFromJson(value, fields));
                    }
                });
            }
        }
        return urls;
    }
    looksLikeArticleUrl(url, baseUrl) {
        try {
            const urlObj = new URL(url);
            const baseObj = new URL(baseUrl);
            // Must be same domain
            if (urlObj.hostname !== baseObj.hostname)
                return false;
            const path = urlObj.pathname;
            // Skip obvious non-article URLs
            if (path.match(/\.(jpg|jpeg|png|gif|css|js|woff2?|ico|svg)$/i))
                return false;
            if (path.match(/^\/api\/|^\/static\/|^\/assets\/|^\/_next\//))
                return false;
            // Skip homepage and common navigation pages
            if (path === '/' || path === '/blog' || path === '/blog/')
                return false;
            if (path.match(/^\/(about|contact|privacy|terms|jobs|careers)$/i))
                return false;
            // Look for article-like patterns
            const hasSlug = path.match(/\/[a-z0-9-]+$/i);
            const hasDate = path.match(/\/\d{4}\/\d{2}\/\d{2}\//);
            const hasCommonPath = path.match(/\/(post|article|blog|story|news)\//i);
            // For Quill specifically, look for blog post patterns
            const isQuillBlogPost = path.match(/^\/blog\/[a-z0-9-]+$/i);
            // Also consider longer paths that might be content
            const hasDeepPath = path.split('/').filter(segment => segment.length > 0).length >= 2;
            const hasContentWords = path.match(/(analytics|data|business|intelligence|embedded|modern|stack|customers|chatgpt|ai|saas|dashboard|reporting)/i);
            return !!(hasSlug || hasDate || hasCommonPath || isQuillBlogPost || (hasDeepPath && hasContentWords));
        }
        catch {
            return false;
        }
    }
    /**
     * MAIN ENTRY POINT: Smart discovery with probe-and-decide logic
     */
    async discover(url, desiredLinkCount = 10) {
        const startTime = Date.now();
        let discoveredUrls = [];
        let interactions = [];
        let layer = 1;
        this.logger.info('Starting smart link discovery', { url, desiredLinkCount });
        try {
            // STEP 1: Quick probe (≤1s)
            const probeResult = await this.quickProbe(url);
            this.logger.info('Probe completed', {
                isJSHeavy: probeResult.isJSHeavy,
                score: probeResult.score,
                indicators: probeResult.indicators
            });
            if (probeResult.isJSHeavy) {
                // Skip cheap methods, go straight to Playwright
                this.logger.info('JS-heavy site detected, using Playwright mode');
                layer = 3;
                const playwrightResult = await this.playwrightMode(url);
                discoveredUrls = playwrightResult.urls;
                interactions = playwrightResult.interactions;
                this.logger.info('Playwright mode completed', {
                    urlsFound: discoveredUrls.length,
                    interactions: interactions.length,
                    stats: playwrightResult.stats
                });
            }
            else {
                // STEP 2: Try cheap methods first
                this.logger.info('Traditional site detected, trying cheap methods');
                discoveredUrls = await this.cheapMethods(url);
                layer = 2;
                // STEP 3: If not enough URLs, escalate to Playwright
                if (discoveredUrls.length < desiredLinkCount) {
                    this.logger.info('Insufficient URLs from cheap methods, escalating to Playwright', {
                        found: discoveredUrls.length,
                        desired: desiredLinkCount
                    });
                    layer = 3;
                    const playwrightResult = await this.playwrightMode(url);
                    // Merge results
                    const allUrls = new Set([...discoveredUrls, ...playwrightResult.urls]);
                    discoveredUrls = Array.from(allUrls);
                    interactions = playwrightResult.interactions;
                }
            }
            const processingTime = Date.now() - startTime;
            const success = discoveredUrls.length >= Math.min(desiredLinkCount, 2); // At least 2 URLs
            this.logger.info('Smart discovery completed', {
                totalUrls: discoveredUrls.length,
                jsHeavy: probeResult.isJSHeavy,
                layer,
                interactions: interactions.length,
                processingTime,
                success
            });
            return {
                urls: discoveredUrls,
                jsHeavy: probeResult.isJSHeavy,
                interactions,
                layer,
                success,
                processingTime,
                score: probeResult.score
            };
        }
        catch (error) {
            const processingTime = Date.now() - startTime;
            this.logger.error('Smart discovery failed', { error, processingTime });
            return {
                urls: discoveredUrls,
                jsHeavy: false,
                interactions,
                layer,
                success: false,
                processingTime,
                score: 0
            };
        }
    }
}
//# sourceMappingURL=smart-link-discoverer.js.map