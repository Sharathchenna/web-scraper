// Centralized selector groups for different interaction types
export const INTERACTION_SELECTORS = {
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
        '[data-action*="load"]',
        '.ecomerce-items-scroll-more' // WebScraper.io specific
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
        'a:has-text(">")',
        '.pagination a:not(.disabled)',
        '.pager a:not(.disabled)',
        '[data-testid*="next"]',
        '[aria-label*="next"]',
        // Page number links
        '.pagination a[href*="page="]',
        '.pager a[href*="page="]',
        'a[href*="page="]'
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
export class InteractionEngine {
    visitedElements = new WeakSet();
    logger;
    config;
    constructor(logger, config) {
        this.logger = logger;
        this.config = config;
    }
    /**
     * Perform all interactive element clicks with smart deduplication
     */
    async clickInteractiveElements(page, baseUrl, harvestUrls, looksLikeArticleUrl) {
        const discoveredUrls = new Set();
        const interactions = [];
        let totalElementsInteracted = 0;
        // Initial URL harvest
        const initialUrls = await harvestUrls(page, baseUrl);
        initialUrls.forEach(url => discoveredUrls.add(url));
        // Phase A: Handle "Load More" buttons
        const loadMoreResult = await this.handleLoadMoreButtons(page, baseUrl, harvestUrls, looksLikeArticleUrl);
        loadMoreResult.urls.forEach(url => discoveredUrls.add(url));
        loadMoreResult.interactions.forEach(interaction => interactions.push(interaction));
        totalElementsInteracted += loadMoreResult.elementsInteracted;
        // Phase B: Handle traditional pagination
        const paginationResult = await this.handlePagination(page, baseUrl, harvestUrls, looksLikeArticleUrl);
        paginationResult.urls.forEach(url => discoveredUrls.add(url));
        paginationResult.interactions.forEach(interaction => interactions.push(interaction));
        totalElementsInteracted += paginationResult.elementsInteracted;
        // Phase C: Handle "Read More" buttons (existing behavior)
        const readMoreResult = await this.handleReadMoreButtons(page, baseUrl, harvestUrls, looksLikeArticleUrl);
        readMoreResult.urls.forEach(url => discoveredUrls.add(url));
        readMoreResult.interactions.forEach(interaction => interactions.push(interaction));
        totalElementsInteracted += readMoreResult.elementsInteracted;
        return {
            urls: Array.from(discoveredUrls),
            interactions,
            elementsInteracted: totalElementsInteracted,
            success: discoveredUrls.size > initialUrls.length
        };
    }
    /**
     * Handle "Load More" buttons that dynamically load content
     */
    async handleLoadMoreButtons(page, baseUrl, harvestUrls, looksLikeArticleUrl) {
        const discoveredUrls = new Set();
        const interactions = [];
        let clickCount = 0;
        try {
            for (let attempt = 0; attempt < this.config.maxLoadMoreClicks; attempt++) {
                let foundButton = false;
                // Try each selector group
                for (const selector of INTERACTION_SELECTORS.loadMore) {
                    try {
                        const elements = await page.locator(selector).all();
                        for (const element of elements) {
                            // Skip if we've already interacted with this element
                            const elementHandle = await element.elementHandle();
                            if (elementHandle && this.visitedElements.has(elementHandle)) {
                                continue;
                            }
                            // Check if element is visible and enabled
                            const isVisible = await element.isVisible();
                            const isEnabled = await element.isEnabled();
                            if (!isVisible || !isEnabled) {
                                continue;
                            }
                            this.logger.debug(`Clicking load more button: ${selector}`);
                            // Scroll into view and throttle
                            await element.scrollIntoViewIfNeeded();
                            await page.waitForTimeout(this.config.throttleMs);
                            // Capture URLs before clicking
                            const urlsBefore = await harvestUrls(page, baseUrl);
                            // Click the element
                            await element.click();
                            clickCount++;
                            foundButton = true;
                            // Mark as visited
                            if (elementHandle) {
                                this.visitedElements.add(elementHandle);
                            }
                            // Wait for content to load with race condition
                            await Promise.race([
                                page.waitForLoadState('networkidle', { timeout: this.config.networkTimeout }),
                                page.waitForTimeout(3000) // Don't hang forever
                            ]);
                            // Harvest new URLs
                            const urlsAfter = await harvestUrls(page, baseUrl);
                            const newUrls = urlsAfter.filter(url => !urlsBefore.includes(url));
                            newUrls.forEach(url => {
                                if (looksLikeArticleUrl(url, baseUrl)) {
                                    discoveredUrls.add(url);
                                }
                            });
                            interactions.push(`Load more click ${clickCount}: Found ${newUrls.length} new URLs`);
                            // If no new content was loaded, break early
                            if (newUrls.length === 0) {
                                interactions.push('No new content loaded, stopping load more attempts');
                                return {
                                    urls: Array.from(discoveredUrls),
                                    interactions,
                                    elementsInteracted: clickCount,
                                    success: true
                                };
                            }
                            break; // Found and clicked a button, try next iteration
                        }
                        if (foundButton)
                            break; // Found button in this selector, move to next iteration
                    }
                    catch (error) {
                        this.logger.debug(`Load more selector failed: ${selector}`, { error });
                    }
                }
                // If no button was found in any selector, we're done
                if (!foundButton) {
                    interactions.push('No more load more buttons found');
                    break;
                }
            }
        }
        catch (error) {
            this.logger.error('Load more handling failed', { error });
            interactions.push(`Load more error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        return {
            urls: Array.from(discoveredUrls),
            interactions,
            elementsInteracted: clickCount,
            success: clickCount > 0
        };
    }
    /**
     * Handle traditional pagination links
     */
    async handlePagination(page, baseUrl, harvestUrls, looksLikeArticleUrl) {
        const discoveredUrls = new Set();
        const interactions = [];
        let hopCount = 0;
        try {
            for (let attempt = 0; attempt < this.config.maxPaginationHops; attempt++) {
                let foundButton = false;
                // Try each selector group
                for (const selector of INTERACTION_SELECTORS.pagination) {
                    try {
                        const elements = await page.locator(selector).all();
                        for (const element of elements) {
                            // Skip if we've already interacted with this element
                            const elementHandle = await element.elementHandle();
                            if (elementHandle && this.visitedElements.has(elementHandle)) {
                                continue;
                            }
                            // Check if element is visible and enabled
                            const isVisible = await element.isVisible();
                            const isEnabled = await element.isEnabled();
                            if (!isVisible || !isEnabled) {
                                continue;
                            }
                            this.logger.debug(`Clicking pagination button: ${selector}`);
                            // Scroll into view and throttle
                            await element.scrollIntoViewIfNeeded();
                            await page.waitForTimeout(this.config.throttleMs);
                            // Capture URLs before clicking
                            const urlsBefore = await harvestUrls(page, baseUrl);
                            // Click and wait for navigation
                            await Promise.all([
                                page.waitForNavigation({ timeout: this.config.networkTimeout }),
                                element.click()
                            ]);
                            // Mark element as visited
                            if (elementHandle) {
                                this.visitedElements.add(elementHandle);
                            }
                            // Capture new URLs after clicking
                            const urlsAfter = await harvestUrls(page, baseUrl);
                            const newUrls = urlsAfter.filter(url => !urlsBefore.includes(url));
                            // Add new URLs to discovered set
                            newUrls.forEach(url => {
                                if (looksLikeArticleUrl(url, baseUrl)) {
                                    discoveredUrls.add(url);
                                }
                            });
                            if (newUrls.length > 0) {
                                interactions.push(`Pagination click found ${newUrls.length} new URLs`);
                                hopCount++;
                                foundButton = true;
                                break;
                            }
                        }
                        if (foundButton)
                            break;
                    }
                    catch (error) {
                        this.logger.debug(`Failed to interact with pagination: ${selector}`, { error });
                    }
                }
                if (!foundButton)
                    break;
            }
            return {
                urls: Array.from(discoveredUrls),
                interactions,
                elementsInteracted: hopCount,
                success: discoveredUrls.size > 0
            };
        }
        catch (error) {
            this.logger.warn('Pagination interaction failed', { error });
            return {
                urls: Array.from(discoveredUrls),
                interactions,
                elementsInteracted: hopCount,
                success: discoveredUrls.size > 0
            };
        }
    }
    /**
     * Handle "Read More" buttons (adapted from existing implementation)
     */
    async handleReadMoreButtons(page, baseUrl, harvestUrls, looksLikeArticleUrl) {
        const discoveredUrls = new Set();
        const interactions = [];
        let clickCount = 0;
        try {
            // Try each read more selector
            for (const selector of INTERACTION_SELECTORS.readMore) {
                try {
                    const elements = await page.locator(selector).all();
                    for (const element of elements) {
                        if (clickCount >= this.config.maxReadMoreClicks) {
                            break;
                        }
                        const elementHandle = await element.elementHandle();
                        if (elementHandle && this.visitedElements.has(elementHandle)) {
                            continue;
                        }
                        const isVisible = await element.isVisible();
                        if (!isVisible) {
                            continue;
                        }
                        this.logger.debug(`Clicking read more: ${selector}`);
                        const originalUrl = page.url();
                        await element.scrollIntoViewIfNeeded();
                        await page.waitForTimeout(this.config.throttleMs);
                        // Click and check for navigation
                        await element.click();
                        clickCount++;
                        if (elementHandle) {
                            this.visitedElements.add(elementHandle);
                        }
                        await page.waitForTimeout(800);
                        const currentUrl = page.url();
                        if (currentUrl !== originalUrl && looksLikeArticleUrl(currentUrl, baseUrl)) {
                            discoveredUrls.add(currentUrl);
                            interactions.push(`Read more navigation: ${currentUrl}`);
                            // Go back to continue with other buttons
                            await page.goBack();
                            await page.waitForLoadState('networkidle', { timeout: 3000 });
                        }
                        else {
                            // Check if content was revealed without navigation
                            const pageUrls = await harvestUrls(page, baseUrl);
                            pageUrls.forEach(url => {
                                if (looksLikeArticleUrl(url, baseUrl)) {
                                    discoveredUrls.add(url);
                                }
                            });
                            if (pageUrls.length > 0) {
                                interactions.push(`Read more revealed ${pageUrls.length} URLs`);
                            }
                        }
                    }
                }
                catch (error) {
                    this.logger.debug(`Read more selector failed: ${selector}`, { error });
                }
            }
        }
        catch (error) {
            this.logger.error('Read more handling failed', { error });
            interactions.push(`Read more error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        return {
            urls: Array.from(discoveredUrls),
            interactions,
            elementsInteracted: clickCount,
            success: clickCount > 0
        };
    }
}
//# sourceMappingURL=interaction-engine.js.map