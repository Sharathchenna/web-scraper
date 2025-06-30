import { InteractionEngine, InteractionConfig, INTERACTION_SELECTORS } from '../src/processors/interaction-engine.js';
import { createLogger } from '../src/utils/logger.js';
import type { Logger } from 'winston';
import type { Page, Locator, ElementHandle } from 'playwright';

// Mock Playwright types
const createMockElementHandle = (): ElementHandle => ({} as ElementHandle);

const createMockLocator = (elements: any[] = []): Locator => ({
  all: jest.fn().mockResolvedValue(elements.map(() => ({
    elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
    isVisible: jest.fn().mockResolvedValue(true),
    isEnabled: jest.fn().mockResolvedValue(true),
    scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    getAttribute: jest.fn().mockResolvedValue('test-href'),
    evaluate: jest.fn().mockResolvedValue('a')
  })))
} as any);

const createMockPage = (overrides: any = {}): Page => ({
  locator: jest.fn().mockReturnValue(createMockLocator()),
  waitForTimeout: jest.fn().mockResolvedValue(undefined),
  waitForLoadState: jest.fn().mockResolvedValue(undefined),
  goto: jest.fn().mockResolvedValue(null),
  goBack: jest.fn().mockResolvedValue(null),
  url: jest.fn().mockReturnValue('https://example.com'),
  ...overrides
} as any);

describe('InteractionEngine', () => {
  let logger: Logger;
  let config: InteractionConfig;
  let engine: InteractionEngine;
  let mockHarvestUrls: jest.Mock;
  let mockLooksLikeArticleUrl: jest.Mock;

  beforeEach(() => {
    logger = createLogger();
    logger.debug = jest.fn();
    logger.error = jest.fn();
    
    config = {
      maxPaginationHops: 3,
      maxLoadMoreClicks: 5,
      maxReadMoreClicks: 3,
      throttleMs: 100,
      interactionTimeout: 2000,
      networkTimeout: 30000
    };
    
    engine = new InteractionEngine(logger, config);
    
    mockHarvestUrls = jest.fn().mockResolvedValue([
      'https://example.com/article1',
      'https://example.com/article2'
    ]);
    
    mockLooksLikeArticleUrl = jest.fn().mockReturnValue(true);
  });

  describe('INTERACTION_SELECTORS', () => {
    it('should contain all expected selector groups', () => {
      expect(INTERACTION_SELECTORS).toHaveProperty('loadMore');
      expect(INTERACTION_SELECTORS).toHaveProperty('readMore');
      expect(INTERACTION_SELECTORS).toHaveProperty('pagination');
      expect(INTERACTION_SELECTORS).toHaveProperty('expandable');
    });

    it('should include WebScraper.io specific selectors', () => {
      expect(INTERACTION_SELECTORS.loadMore).toContain('.ecomerce-items-scroll-more');
    });

    it('should include comprehensive pagination selectors', () => {
      expect(INTERACTION_SELECTORS.pagination).toContain('a:has-text("Next")');
      expect(INTERACTION_SELECTORS.pagination).toContain('a:has-text("→")');
      expect(INTERACTION_SELECTORS.pagination).toContain('.pagination a:not(.disabled)');
    });
  });

  describe('clickInteractiveElements', () => {
    it('should call all interaction handlers in sequence', async () => {
      const mockPage = createMockPage();
      
      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(result).toHaveProperty('urls');
      expect(result).toHaveProperty('interactions');
      expect(result).toHaveProperty('elementsInteracted');
      expect(result).toHaveProperty('success');
      expect(mockHarvestUrls).toHaveBeenCalled();
    });

    it('should include initial URLs in the result', async () => {
      const mockPage = createMockPage();
      
      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(result.urls).toContain('https://example.com/article1');
      expect(result.urls).toContain('https://example.com/article2');
    });
  });

  describe('handleLoadMoreButtons', () => {
    it('should find and click load more buttons', async () => {
      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      // Mock harvestUrls to return different results before/after click
      mockHarvestUrls
        .mockResolvedValueOnce(['https://example.com/article1']) // before click
        .mockResolvedValueOnce(['https://example.com/article1', 'https://example.com/article2']); // after click

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockElements[0]?.click).toHaveBeenCalled();
      expect(result.elementsInteracted).toBeGreaterThan(0);
    });

    it('should stop clicking when no new content is loaded', async () => {
      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      // Mock harvestUrls to return same results (no new content)
      mockHarvestUrls.mockResolvedValue(['https://example.com/article1']);

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(result.interactions).toContain('No new content loaded, stopping load more attempts');
    });

    it('should respect maxLoadMoreClicks limit', async () => {
      const configWithLowLimit = { ...config, maxLoadMoreClicks: 1 };
      const limitedEngine = new InteractionEngine(logger, configWithLowLimit);

      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      mockHarvestUrls
        .mockResolvedValueOnce([]) // initial
        .mockResolvedValue(['https://example.com/new-article']); // after each click

      const result = await limitedEngine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      // Should stop after 1 click due to limit
      expect(mockElements[0]?.click).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePagination', () => {
    it('should navigate through pagination links', async () => {
      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue('a'), // tagName
          getAttribute: jest.fn().mockResolvedValue('/page/2'), // href
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        }),
        goto: jest.fn().mockResolvedValue(null)
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://example.com/page/2',
        expect.any(Object)
      );
    });

    it('should skip invalid pagination links', async () => {
      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue('a'),
          getAttribute: jest.fn().mockResolvedValue('#'), // invalid href
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should respect maxPaginationHops limit', async () => {
      const configWithLowLimit = { ...config, maxPaginationHops: 1 };
      const limitedEngine = new InteractionEngine(logger, configWithLowLimit);

      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue('a'),
          getAttribute: jest.fn().mockResolvedValue('/page/2'),
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      const result = await limitedEngine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      // Should only navigate once due to limit
      expect(mockPage.goto).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleReadMoreButtons', () => {
    it('should click read more buttons and capture navigation', async () => {
      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      let urlCallCount = 0;
      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        }),
        url: jest.fn(() => {
          urlCallCount++;
          return urlCallCount === 1 ? 'https://example.com' : 'https://example.com/article';
        }),
        goBack: jest.fn().mockResolvedValue(null)
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockElements[0]?.click).toHaveBeenCalled();
      expect(mockPage.goBack).toHaveBeenCalled();
      expect(result.urls).toContain('https://example.com/article');
    });

    it('should respect maxReadMoreClicks limit', async () => {
      const configWithLowLimit = { ...config, maxReadMoreClicks: 1 };
      const limitedEngine = new InteractionEngine(logger, configWithLowLimit);

      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined)
        },
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined)
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      const result = await limitedEngine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      // Should only click first element due to limit
      expect(mockElements[0]?.click).toHaveBeenCalledTimes(1);
      expect(mockElements[1]?.click).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle selector failures gracefully', async () => {
      const mockPage = createMockPage({
        locator: jest.fn().mockImplementation(() => {
          throw new Error('Selector failed');
        })
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(result.success).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.any(Object)
      );
    });

    it('should handle click failures gracefully', async () => {
      const mockElements = [
        {
          elementHandle: jest.fn().mockResolvedValue(createMockElementHandle()),
          isVisible: jest.fn().mockResolvedValue(true),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockRejectedValue(new Error('Click failed'))
        }
      ];

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue(mockElements)
        })
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      // Should not crash and should log the error
      expect(result).toBeDefined();
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('element deduplication', () => {
    it('should not interact with the same element twice', async () => {
      const mockElementHandle = createMockElementHandle();
      const mockElement = {
        elementHandle: jest.fn().mockResolvedValue(mockElementHandle),
        isVisible: jest.fn().mockResolvedValue(true),
        isEnabled: jest.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined)
      };

      const mockPage = createMockPage({
        locator: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue([mockElement, mockElement]) // Same element twice
        })
      });

      mockHarvestUrls
        .mockResolvedValueOnce([]) // initial
        .mockResolvedValue(['https://example.com/new-article']); // after click

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      // Should only click once despite element appearing twice
      expect(mockElement.click).toHaveBeenCalledTimes(1);
    });
  });

  describe('frame harvesting', () => {
    it('should harvest URLs from iframes', async () => {
      const mockFrameAnchors = [
        {
          getAttribute: jest.fn().mockResolvedValue('https://example.com/frame-article1'),
          isVisible: jest.fn().mockResolvedValue(true)
        },
        {
          getAttribute: jest.fn().mockResolvedValue('https://example.com/frame-article2'),
          isVisible: jest.fn().mockResolvedValue(true)
        }
      ];

      const mockFrame = {
        url: jest.fn().mockReturnValue('https://example.com/frame'),
        $$: jest.fn().mockResolvedValue(mockFrameAnchors)
      };

      const mockPage = createMockPage({
        frames: jest.fn().mockReturnValue([
          { url: jest.fn().mockReturnValue('https://example.com'), mainFrame: true },
          mockFrame
        ]),
        mainFrame: jest.fn().mockReturnValue({ url: jest.fn().mockReturnValue('https://example.com') })
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockFrame.$$).toHaveBeenCalledWith('a[href]');
      expect(result.interactions).toContain('Processing frame: https://example.com/frame');
    });

    it('should handle cross-origin frame access errors gracefully', async () => {
      const mockFrame = {
        url: jest.fn().mockReturnValue('https://other-domain.com/frame'),
        $$: jest.fn().mockRejectedValue(new Error('Cross-origin access denied'))
      };

      const mockPage = createMockPage({
        frames: jest.fn().mockReturnValue([
          { url: jest.fn().mockReturnValue('https://example.com'), mainFrame: true },
          mockFrame
        ]),
        mainFrame: jest.fn().mockReturnValue({ url: jest.fn().mockReturnValue('https://example.com') })
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockFrame.$$).toHaveBeenCalledWith('a[href]');
      expect(logger.debug).toHaveBeenCalledWith(
        'Failed to access frame content',
        expect.objectContaining({
          frameUrl: 'https://other-domain.com/frame',
          reason: 'Cross-origin access denied'
        })
      );
      expect(result.success).toBe(true); // Should still succeed overall
    });

    it('should extract URLs from JSON-LD in frames', async () => {
      const mockJsonLdScript = {
        textContent: jest.fn().mockResolvedValue(JSON.stringify({
          '@type': 'Article',
          url: 'https://example.com/frame-article-jsonld'
        }))
      };

      const mockFrame = {
        url: jest.fn().mockReturnValue('https://example.com/frame'),
        $$: jest.fn()
          .mockImplementation((selector) => {
            if (selector === 'a[href]') {
              return [];
            }
            if (selector === 'script[type="application/ld+json"]') {
              return [mockJsonLdScript];
            }
            return [];
          })
      };

      const mockPage = createMockPage({
        frames: jest.fn().mockReturnValue([
          { url: jest.fn().mockReturnValue('https://example.com'), mainFrame: true },
          mockFrame
        ]),
        mainFrame: jest.fn().mockReturnValue({ url: jest.fn().mockReturnValue('https://example.com') })
      });

      const result = await engine.clickInteractiveElements(
        mockPage,
        'https://example.com',
        mockHarvestUrls,
        mockLooksLikeArticleUrl
      );

      expect(mockFrame.$$).toHaveBeenCalledWith('script[type="application/ld+json"]');
      expect(result.interactions).toContain('Frame JSON-LD URL found: https://example.com/frame-article-jsonld');
    });
  });
}); 