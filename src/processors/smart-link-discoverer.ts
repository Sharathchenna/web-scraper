import { createLogger } from '../utils/logger.js';
import type { Logger } from 'winston';
import { XMLParser } from 'fast-xml-parser';
import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { JSDOM } from 'jsdom';
import { InteractionEngine, InteractionConfig } from './interaction-engine.js';
import { AuthEngine, AuthConfig } from './auth-engine.js';

interface SmartDiscoveryResult {
  urls: string[];
  interactions: string[];
  success: boolean;
  durationMs: number;
}

interface ProbeResult {
  isJSHeavy: boolean;
  score: number;
  indicators: string[];
}

interface InteractionStats {
  buttonsClicked: number;
  scrollAttempts: number;
  urlsFound: number;
  networkRequests: number;
}

interface JsonData {
  [key: string]: unknown;
}

interface RSSItem {
  link?: string;
  guid?: string;
  url?: string;
}

interface AtomEntry {
  link?: string;
  id?: string;
  url?: string;
}

interface RSSFeed {
  rss?: {
    channel?: {
      item?: RSSItem[];
    };
  };
  feed?: {
    entry?: AtomEntry[];
  };
}

export class SmartLinkDiscoverer {
  private readonly logger: Logger;
  private readonly interactionEngine: InteractionEngine;
  private readonly authEngine: AuthEngine;
  private readonly xmlParser: XMLParser;
  private readonly config: InteractionConfig & AuthConfig;
  
  // Configuration constants
  private static readonly JS_HEAVY_THRESHOLD = 50;
  private static readonly MAX_SCROLL_ATTEMPTS = 5;
  private static readonly MAX_CLICK_ATTEMPTS = 3;
  private static readonly INTERACTION_TIMEOUT = 2000;
  private static readonly NETWORK_TIMEOUT = 30000;

  constructor(logger?: Logger, config?: Partial<InteractionConfig & AuthConfig>) {
    this.logger = logger || createLogger();
    this.config = {
      maxPaginationHops: 3,
      maxLoadMoreClicks: 5,
      maxReadMoreClicks: 3,
      throttleMs: 1000,
      interactionTimeout: 5000,
      networkTimeout: 30000,
      username: process.env.SMART_DISCOVERY_TEST_USER || 'test_user',
      password: process.env.SMART_DISCOVERY_TEST_PASS || 'test_pass',
      maxAttempts: 1,
      ...config
    };
    this.interactionEngine = new InteractionEngine(this.logger, this.config);
    this.authEngine = new AuthEngine(this.logger, this.config);
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true
    });
  }

  /**
   * STEP 1: Quick probe to determine if site is JavaScript-heavy (≤1s)
   */
  private async quickProbe(url: string): Promise<ProbeResult> {
    let score = 0;
    const indicators: string[] = [];

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
      const { window } = dom;
      const { document } = window;

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

    } catch (error) {
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
  private async cheapMethods(url: string): Promise<string[]> {
    const discoveredUrls = new Set<string>();

    // Method A: Static HTML scraping
    try {
      const response = await fetch(url);
      const html = await response.text();
      const staticUrls = this.extractStaticLinks(html, url);
      staticUrls.forEach(url => discoveredUrls.add(url));
      this.logger.debug('Static scraping completed', { urlsFound: staticUrls.length });
    } catch (error) {
      this.logger.debug('Static scraping failed', { error });
    }

    // Method B: RSS/Sitemap probing
    try {
      const feedUrls = await this.probeFeedsAndSitemaps(url);
      feedUrls.forEach(url => discoveredUrls.add(url));
      this.logger.debug('Feed probing completed', { urlsFound: feedUrls.length });
    } catch (error) {
      this.logger.debug('Feed probing failed', { error });
    }

    return Array.from(discoveredUrls);
  }

  /**
   * STEP 3: Headless Playwright mode with smart interactions
   */
  private async playwrightMode(url: string): Promise<{ urls: string[], interactions: string[], stats: InteractionStats }> {
    const discoveredUrls = new Set<string>();
    const interactions: string[] = [];
    const stats: InteractionStats = {
      buttonsClicked: 0,
      scrollAttempts: 0,
      urlsFound: 0,
      networkRequests: 0
    };

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

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
          } catch (e) {
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

      // Create interaction engine and handle all interactive elements
      const interactionEngine = new InteractionEngine(this.logger, this.config);
      const interactionResults = await interactionEngine.clickInteractiveElements(
        page, 
        url, 
        this.harvestAllUrls.bind(this),
        this.looksLikeArticleUrl.bind(this)
      );
      
      interactionResults.urls.forEach(url => discoveredUrls.add(url));
      interactionResults.interactions.forEach(interaction => interactions.push(interaction));
      stats.buttonsClicked = interactionResults.elementsInteracted;

      // Phase B: Infinite scroll (keep existing behavior)
      const scrollResults = await this.performInfiniteScroll(page, url);
      scrollResults.urls.forEach(url => discoveredUrls.add(url));
      scrollResults.interactions.forEach(interaction => interactions.push(interaction));

      // NEW: Phase C: Frame harvesting
      const frameResults = await this.harvestFrameUrls(page, url);
      frameResults.urls.forEach(url => discoveredUrls.add(url));
      frameResults.interactions.forEach(interaction => interactions.push(interaction));

      // Final harvest of all URLs on page
      const finalUrls = await this.harvestAllUrls(page, url);
      finalUrls.forEach(url => discoveredUrls.add(url));

      stats.urlsFound = discoveredUrls.size;

    } catch (error) {
      this.logger.error('Playwright mode failed', { error });
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
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
  private async clickRevealerButtons(page: Page, baseUrl: string): Promise<{ urls: string[], interactions: string[], buttonsClicked: number }> {
    const discoveredUrls = new Set<string>();
    const interactions: string[] = [];
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
          if (!button) continue;
          
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
          
        } catch (clickError) {
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
              if (!element) continue;

              const href = await element.getAttribute('href').catch(() => null);
              if (href) {
                const absoluteUrl = new URL(href, baseUrl).toString();
                if (this.looksLikeArticleUrl(absoluteUrl, baseUrl)) {
                  discoveredUrls.add(absoluteUrl);
                  interactions.push(`Fallback link: ${absoluteUrl}`);
                }
              }
            }
          } catch (e) {
            // Continue with next selector
          }
        }
      }

    } catch (error) {
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
  private async performInfiniteScroll(page: Page, baseUrl: string): Promise<{ urls: string[], interactions: string[], scrollAttempts: number }> {
    const discoveredUrls = new Set<string>();
    const interactions: string[] = [];
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
  private async harvestAllUrls(page: Page, baseUrl: string): Promise<string[]> {
    const urls = new Set<string>();
    
    // Get all anchor elements
    const anchors = await page.$$('a');
    for (const anchor of anchors) {
      const href = await anchor.getAttribute('href');
      if (href && this.looksLikeArticleUrl(href, baseUrl)) {
        urls.add(new URL(href, baseUrl).toString());
      }
    }

    return Array.from(urls);
  }

  /**
   * Helper methods
   */
  private extractStaticLinks(html: string, baseUrl: string): string[] {
    const urls = new Set<string>();
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
        } catch {
          // Ignore invalid URLs
        }
      }
    });

    return Array.from(urls);
  }

  private async probeFeedsAndSitemaps(baseUrl: string): Promise<string[]> {
    const urls = new Set<string>();
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
      } catch {
        // Ignore feed errors
      }
    }

    return Array.from(urls);
  }

  private extractUrlsFromXML(xml: RSSFeed): string[] {
    const urls: string[] = [];
    
    // Handle RSS format
    if (xml.rss?.channel?.item) {
      urls.push(...xml.rss.channel.item
        .map(item => item.link)
        .filter((url): url is string => typeof url === 'string')
      );
    }

    // Handle Atom format
    if (xml.feed?.entry) {
      urls.push(...xml.feed.entry
        .map(entry => entry.link)
        .filter((url): url is string => typeof url === 'string')
      );
    }

    return urls;
  }

  private extractUrlsFromJson(data: JsonData | JsonData[], fields: string[] = ['url', 'href', 'link', '@id']): string[] {
    const urls: string[] = [];
    
    if (Array.isArray(data)) {
      data.forEach(item => {
        urls.push(...this.extractUrlsFromJson(item, fields));
      });
      return urls;
    }

    for (const [key, value] of Object.entries(data)) {
      if (fields.includes(key) && typeof value === 'string') {
        urls.push(value);
      } else if (value && (typeof value === 'object' || Array.isArray(value))) {
        urls.push(...this.extractUrlsFromJson(value as JsonData | JsonData[], fields));
      }
    }
    
    return urls;
  }

  private looksLikeArticleUrl(url: string, baseUrl: string): boolean {
    // Common patterns for article URLs
    const articlePatterns = [
      /\/blog\//i,
      /\/article\//i,
      /\/post\//i,
      /\/news\//i,
      /\/story\//i,
      /\/\d{4}\/\d{2}\//i, // Date-based URLs
      /\.(html|htm)$/i
    ];

    try {
      const urlObj = new URL(url, baseUrl);
      const path = urlObj.pathname;

      // Check if URL matches any article pattern
      return articlePatterns.some(pattern => pattern.test(path));
    } catch (error) {
      this.logger.warn('Invalid URL in article check:', { url, error });
      return false;
    }
  }

  /**
   * MAIN ENTRY POINT: Smart discovery with probe-and-decide logic
   */
  public async discover(url: string, desiredLinkCount: number = 10): Promise<SmartDiscoveryResult> {
    const startTime = Date.now();
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.config.maxAttempts) {
      try {
        // If this is a retry, wait with exponential backoff
        if (attempt > 0 && this.config.backoffMs) {
          const backoffTime = this.config.backoffMs * Math.pow(2, attempt - 1);
          this.logger.debug(`Retry attempt ${attempt}, waiting ${backoffTime}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }

        // Probe for JS-heavy indicators
        const probeResult = await this.quickProbe(url);
        this.logger.debug('Quick probe results', probeResult);

        // Try cheap methods first
        const cheapUrls = await this.cheapMethods(url);
        if (cheapUrls.length >= desiredLinkCount && !probeResult.isJSHeavy) {
          return {
            urls: cheapUrls,
            interactions: ['Used static extraction'],
            success: true,
            durationMs: Date.now() - startTime
          };
        }

        // If cheap methods weren't enough or site is JS-heavy, use Playwright
        const browser = await chromium.launch();
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        const page = await context.newPage();

        try {
          await page.goto(url, { 
            waitUntil: 'networkidle',
            timeout: this.config.networkTimeout 
          });

          const result = await this.processPage(page, url);
          await browser.close();

          // Combine results from both methods
          const allUrls = [...new Set([...cheapUrls, ...result.urls])];
          return {
            urls: allUrls,
            interactions: [
              'Used hybrid extraction',
              ...result.interactions
            ],
            success: true,
            durationMs: Date.now() - startTime
          };

        } catch (error) {
          await browser.close();
          throw error;
        }

      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;
        this.logger.warn(`Attempt ${attempt + 1} failed`, { error });
        attempt++;

        // If this was our last attempt, return error result
        if (attempt >= this.config.maxAttempts) {
          return {
            urls: [],
            interactions: [`Failed after ${attempt} attempts: ${error.message}`],
            success: false,
            durationMs: Date.now() - startTime
          };
        }
      }
    }

    // This should never happen due to the return in the catch block above
    return {
      urls: [],
      interactions: [`Unexpected error after ${attempt} attempts: ${lastError?.message || 'Unknown error'}`],
      success: false,
      durationMs: Date.now() - startTime
    };
  }

  private async processPage(page: Page, baseUrl: string): Promise<SmartDiscoveryResult> {
    const startTime = Date.now();
    const discoveredUrls = new Set<string>();
    const interactions: string[] = [];

    try {
      // Initial URL harvest
      const initialUrls = await this.harvestAllUrls(page, baseUrl);
      initialUrls.forEach(url => discoveredUrls.add(url));

      // Check for authentication requirement
      const authResult = await this.authEngine.handleAuthentication(page);
      if (authResult.success) {
        interactions.push(...authResult.interactions);
        
        // Re-harvest URLs after authentication
        const postAuthUrls = await this.harvestAllUrls(page, baseUrl);
        postAuthUrls.forEach(url => discoveredUrls.add(url));
      } else if (authResult.interactions.length > 0) {
        interactions.push(...authResult.interactions);
      }

      // Handle pagination and dynamic content
      const interactionResult = await this.interactionEngine.clickInteractiveElements(
        page,
        baseUrl,
        this.harvestAllUrls.bind(this),
        this.looksLikeArticleUrl.bind(this)
      );
      interactions.push(...interactionResult.interactions);
      interactionResult.urls.forEach((url: string) => discoveredUrls.add(url));

      return {
        urls: Array.from(discoveredUrls),
        interactions,
        durationMs: Date.now() - startTime,
        success: discoveredUrls.size > 0
      };

    } catch (error) {
      this.logger.error('Page processing failed', { error });
      return {
        urls: Array.from(discoveredUrls),
        interactions: [...interactions, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        durationMs: Date.now() - startTime,
        success: false
      };
    }
  }

  /**
   * Harvest URLs from all frames in the page
   */
  private async harvestFrameUrls(page: Page, baseUrl: string): Promise<{ urls: string[], interactions: string[] }> {
    const discoveredUrls = new Set<string>();
    const interactions: string[] = [];

    try {
      // Get all frames including main frame
      const frames = page.frames();
      
      for (const frame of frames) {
        // Skip the main frame as we already process it
        if (frame === page.mainFrame()) {
          continue;
        }

        try {
          // Try to get frame URL and log it
          const frameUrl = frame.url();
          if (frameUrl) {
            interactions.push(`Processing frame: ${frameUrl}`);
          }

          // Get all anchor elements in the frame
          const anchors = await frame.$$('a[href]');
          for (const anchor of anchors) {
            try {
              const href = await anchor.getAttribute('href');
              if (href && this.looksLikeArticleUrl(href, baseUrl)) {
                const absoluteUrl = new URL(href, baseUrl).toString();
                discoveredUrls.add(absoluteUrl);
                interactions.push(`Frame URL found: ${absoluteUrl}`);
              }
            } catch (error) {
              // Skip individual anchor errors
              this.logger.debug('Failed to process anchor in frame', { error });
            }
          }

          // Also check for JSON-LD data in the frame
          const scripts = await frame.$$('script[type="application/ld+json"]');
          for (const script of scripts) {
            try {
              const content = await script.textContent();
              if (content) {
                const urls = this.extractUrlsFromJson(JSON.parse(content));
                urls.forEach(url => {
                  if (this.looksLikeArticleUrl(url, baseUrl)) {
                    discoveredUrls.add(url);
                    interactions.push(`Frame JSON-LD URL found: ${url}`);
                  }
                });
              }
            } catch (error) {
              // Skip individual script errors
              this.logger.debug('Failed to process JSON-LD in frame', { error });
            }
          }

        } catch (error) {
          // Log frame access errors but continue with other frames
          this.logger.debug('Failed to access frame content', { 
            error,
            frameUrl: frame.url(),
            reason: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      this.logger.error('Frame harvesting failed', { error });
    }

    return {
      urls: Array.from(discoveredUrls),
      interactions
    };
  }
} 