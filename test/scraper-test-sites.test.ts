import { SmartLinkDiscoverer } from '../src/processors/smart-link-discoverer';
import { createLogger } from '../src/utils/logger';
import type { Logger } from 'winston';
import { LinkDiscoverer } from '../src/processors/link-discoverer';
import { FirecrawlExtractor, FirecrawlConfig } from '../src/processors/firecrawl-extractor';

// Increase timeouts for all tests in this file
jest.setTimeout(60000); // 60 seconds

describe('Scraper Test Sites Integration', () => {
  let logger: Logger;
  let discoverer: SmartLinkDiscoverer;

  beforeEach(() => {
    logger = createLogger();
    logger.debug = jest.fn();
    logger.error = jest.fn();
    
    discoverer = new SmartLinkDiscoverer(logger, {
      maxPaginationHops: 3,
      maxLoadMoreClicks: 5,
      maxReadMoreClicks: 3,
      throttleMs: 1000,
      interactionTimeout: 15000, // Increased for JS-heavy sites
      networkTimeout: 30000,
      username: 'test_user',
      password: 'test_pass',
      maxAttempts: 3, // Added retries
      backoffMs: 1000 // Base backoff time between retries
    });
  });

  // Helper function to validate discovered URLs
  const validateUrls = (urls: string[]) => {
    for (const url of urls) {
      expect(url).toMatch(/^https?:\/\//); // Must be absolute URLs
      expect(url.length).toBeGreaterThan(10); // Reasonable minimum length
      expect(url).not.toMatch(/[<>"]/); // No unescaped HTML chars
    }
  };

  describe('1. Static HTML Sites', () => {
    test('should scrape Books to Scrape - simple list & pagination', async () => {
      const result = await discoverer.discover('https://books.toscrape.com');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(20); // At least one page worth
      expect(result.interactions).toContain(expect.stringMatching(/pagination/i));
      validateUrls(result.urls);
      
      // Validate book URLs specifically
      const bookUrls = result.urls.filter(url => url.includes('/catalogue/'));
      expect(bookUrls.length).toBeGreaterThan(0);
    });

    test('should scrape Quotes - microdata & pagination', async () => {
      const result = await discoverer.discover('http://quotes.toscrape.com');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
      expect(result.interactions).toContain(expect.stringMatching(/pagination/i));
      validateUrls(result.urls);

      // Check for quote author pages
      const authorUrls = result.urls.filter(url => url.includes('/author/'));
      expect(authorUrls.length).toBeGreaterThan(0);
    });

    test('should scrape Countries - single page dataset', async () => {
      const result = await discoverer.discover('https://www.scrapethissite.com/pages/simple/');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
      validateUrls(result.urls);

      // Verify country data presence
      expect(result.interactions).toContain(expect.stringMatching(/country/i));
    });
  });

  describe('2. Traditional Pagination', () => {
    test('should handle WebScraper.io e-commerce pagination', async () => {
      const result = await discoverer.discover('https://webscraper.io/test-sites/e-commerce/static');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(20); // Multiple pages
      expect(result.interactions).toContain(expect.stringMatching(/pagination/i));
      validateUrls(result.urls);

      // Check for product URLs
      const productUrls = result.urls.filter(url => url.includes('/product/'));
      expect(productUrls.length).toBeGreaterThan(0);
    });

    test('should handle Hockey Teams search & pagination', async () => {
      const result = await discoverer.discover('https://www.scrapethissite.com/pages/forms/');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
      expect(result.interactions).toContain(expect.stringMatching(/form/i));
      validateUrls(result.urls);

      // Verify form interaction
      expect(result.interactions).toContain(expect.stringMatching(/submit/i));
    });
  });

  describe('3. Infinite Scrolling / Load More / AJAX', () => {
    test('should handle Quotes infinite scroll', async () => {
      const result = await discoverer.discover('http://quotes.toscrape.com/scroll');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(10);
      expect(result.interactions).toContain(expect.stringMatching(/scroll/i));
      validateUrls(result.urls);

      // Verify scroll interaction count
      const scrollCount = result.interactions.filter(i => i.includes('scroll')).length;
      expect(scrollCount).toBeGreaterThan(1);
    });

    test('should handle delayed JS content with retry', async () => {
      const result = await discoverer.discover('http://quotes.toscrape.com/js-delayed?delay=5000');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
      validateUrls(result.urls);

      // Verify wait behavior
      expect(result.interactions).toContain(expect.stringMatching(/waited.*content/i));
    });

    test('should handle AJAX pagination', async () => {
      const result = await discoverer.discover('https://webscraper.io/test-sites/e-commerce/ajax');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(20);
      expect(result.interactions).toContain(expect.stringMatching(/ajax/i));
      validateUrls(result.urls);

      // Verify XHR requests
      expect(result.interactions).toContain(expect.stringMatching(/xhr/i));
    });

    test('should handle Load More button with multiple clicks', async () => {
      const result = await discoverer.discover('https://webscraper.io/test-sites/e-commerce/load-more');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(20);
      expect(result.interactions).toContain(expect.stringMatching(/load more/i));
      validateUrls(result.urls);

      // Verify multiple button clicks
      const clickCount = result.interactions.filter(i => i.includes('clicked')).length;
      expect(clickCount).toBeGreaterThan(1);
    });

    test('should handle scroll-triggered loading', async () => {
      const result = await discoverer.discover('https://webscraper.io/test-sites/e-commerce/scroll');
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(20);
      expect(result.interactions).toContain(expect.stringMatching(/scroll/i));
      validateUrls(result.urls);

      // Verify scroll distance
      expect(result.interactions).toContain(expect.stringMatching(/scrolled.*bottom/i));
    });
  });

  describe('4. Authentication & CSRF', () => {
    test('should handle form login with CSRF', async () => {
      const result = await discoverer.discover('http://quotes.toscrape.com/login');
      expect(result.success).toBe(true);
      expect(result.interactions).toContain(expect.stringMatching(/csrf/i));
      expect(result.interactions).toContain(expect.stringMatching(/login/i));
      validateUrls(result.urls);

      // Verify CSRF token handling
      expect(result.interactions).toContain(expect.stringMatching(/extracted.*token/i));
    });

    test('should handle ViewState + AJAX filter', async () => {
      const result = await discoverer.discover('http://quotes.toscrape.com/search.aspx');
      expect(result.success).toBe(true);
      expect(result.interactions).toContain(expect.stringMatching(/viewstate/i));
      validateUrls(result.urls);

      // Verify ASP.NET form handling
      expect(result.interactions).toContain(expect.stringMatching(/form.*submitted/i));
    });
  });

  describe('5. Frames / iFrames', () => {
    test('should handle nested frames', async () => {
      const result = await discoverer.discover('https://www.scrapethissite.com/pages/frames/');
      expect(result.success).toBe(true);
      expect(result.interactions).toContain(expect.stringMatching(/frame/i));
      validateUrls(result.urls);

      // Verify frame traversal
      expect(result.interactions).toContain(expect.stringMatching(/traversed.*frames/i));
    });
  });

  describe('6. HTTP & Networking', () => {
    test('should handle various HTTP verbs and headers', async () => {
      const result = await discoverer.discover('https://httpbin.org');
      expect(result.success).toBe(true);
      validateUrls(result.urls);
    });

    test('should handle network errors gracefully', async () => {
      const result = await discoverer.discover('https://httpbin.org/status/500');
      expect(result.success).toBe(false);
      expect(result.interactions).toContain(expect.stringMatching(/error.*500/i));
    });

    test('should handle timeouts gracefully', async () => {
      const result = await discoverer.discover('https://httpbin.org/delay/10');
      expect(result.success).toBe(false);
      expect(result.interactions).toContain(expect.stringMatching(/timeout/i));
    });
  });

  describe('7. Error Cases', () => {
    test('should handle 404 pages gracefully', async () => {
      const result = await discoverer.discover('https://httpbin.org/status/404');
      expect(result.success).toBe(false);
      expect(result.interactions).toContain(expect.stringMatching(/error.*404/i));
    });

    test('should handle invalid URLs gracefully', async () => {
      const result = await discoverer.discover('not-a-valid-url');
      expect(result.success).toBe(false);
      expect(result.interactions).toContain(expect.stringMatching(/invalid.*url/i));
    });

    test('should handle rate limiting gracefully', async () => {
      // Make multiple rapid requests to trigger rate limiting
      const results = await Promise.all([
        discoverer.discover('https://httpbin.org/status/429'),
        discoverer.discover('https://httpbin.org/status/429'),
        discoverer.discover('https://httpbin.org/status/429')
      ]);
      
      const rateLimited = results.some(r => 
        r.interactions.some(i => i.includes('rate limit'))
      );
      expect(rateLimited).toBe(true);
    });
  });
});

describe('Substack Integration Tests', () => {
  let linkDiscoverer: LinkDiscoverer;
  let firecrawlExtractor: FirecrawlExtractor;
  let logger: Logger;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as unknown as Logger;
    
    linkDiscoverer = new LinkDiscoverer(logger);
    firecrawlExtractor = new FirecrawlExtractor({
      logger,
      error: '',
      success: true
    } as FirecrawlConfig);
  });

  describe('Link Discovery', () => {
    it('should discover posts from Substack archive API', async () => {
      const result = await linkDiscoverer.discoverLinks('https://shreycation.substack.com');
      
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
      expect(result.urls[0]).toMatch(/^https:\/\/shreycation\.substack\.com\/p\//);
    });

    it('should handle invalid Substack URLs gracefully', async () => {
      const result = await linkDiscoverer.discoverLinks('https://invalid-blog.substack.com');
      
      expect(result.success).toBe(false);
      expect(result.urls).toHaveLength(0);
    });
  });

  describe('Content Extraction', () => {
    it('should extract content from a Substack post', async () => {
      const result = await firecrawlExtractor.scrapeUrl('https://shreycation.substack.com/p/example-post');
      
      expect(result.success).toBe(true);
      expect(result.markdown).toBeTruthy();
      expect(result.html).toBeTruthy();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          title: expect.any(String),
          author: expect.any(String),
          date: expect.any(String)
        })
      );
    });

    it('should handle paywalled content correctly', async () => {
      const result = await firecrawlExtractor.scrapeUrl('https://shreycation.substack.com/p/paywalled-post');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('paywalled');
    });

    it('should handle preview content correctly', async () => {
      const result = await firecrawlExtractor.scrapeUrl('https://shreycation.substack.com/p/preview-post');
      
      expect(result.success).toBe(true);
      expect(result.markdown).toBeTruthy();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('preview content only'));
    });
  });

  describe('Substack Support', () => {
    const testUrl = 'https://shreycation.substack.com';
    const publicPostUrl = 'https://shreycation.substack.com/p/snacks-its-not-too-late-for-euro';
    const nonExistentUrl = 'https://shreycation.substack.com/p/non-existent-post';
    const paywalledPostUrl = 'https://shreycation.substack.com/p/paywalled-post';

    it('should discover posts from Substack archive', async () => {
      const result = await linkDiscoverer.discoverLinks(testUrl);
      
      expect(result.success).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
      expect(result.jsHeavy).toBe(false);
      
      // Verify URL format
      const sampleUrl = result.urls[0];
      expect(sampleUrl).toMatch(/^https:\/\/shreycation\.substack\.com\/(p\/)?[a-z0-9-]+$/);
    });

    it('should extract content from a Substack post', async () => {
      const result = await firecrawlExtractor.scrapeUrl(publicPostUrl);
      
      expect(result.success).toBe(true);
      expect(result.html).toBeDefined();
      expect(result.html?.length).toBeGreaterThan(0);
      
      // Verify metadata
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.title).toBeDefined();
      expect(result.metadata?.author).toBeDefined();
      expect(result.metadata?.date_published).toBeDefined();
      expect(result.metadata?.source_url).toBeDefined();
      expect(result.metadata?.platform).toBe('substack');
    });

    it('should handle non-existent posts gracefully', async () => {
      const result = await firecrawlExtractor.scrapeUrl(nonExistentUrl);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('not_found');
      expect(result.metadata?.error_type).toBe('not_found');
    });

    it('should handle paywalled content gracefully', async () => {
      const result = await firecrawlExtractor.scrapeUrl(paywalledPostUrl);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('paywalled');
      expect(result.metadata?.error_type).toBe('paywalled');
    });
  });
}); 