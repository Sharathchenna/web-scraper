import type { Logger } from 'winston';
interface LinkDiscoveryResult {
    urls: string[];
    layer: number;
    success: boolean;
    jsHeavy?: boolean;
    interactionsPerformed?: string[];
}
export declare class LinkDiscoverer {
    private logger;
    private static readonly MAX_HEADLESS_BROWSERS;
    private static readonly FRESH_ONLY_DAYS;
    private static readonly MAX_FEED_ITEMS;
    private static readonly NETWORK_TIMEOUT;
    private static readonly JS_HEAVY_THRESHOLD;
    private xmlParser;
    private static readonly PLATFORM_PATTERNS;
    private static readonly INTERACTION_SELECTORS;
    constructor(logger?: Logger);
    /**
     * Detects if a website is JavaScript-heavy by analyzing various indicators
     */
    private detectJavaScriptHeaviness;
    /**
     * Layer 1: Extract links from static HTML content using JSON-LD, OG tags, and custom attributes
     */
    private extractLinksFromContent;
    /**
     * Layer 2: Probe for RSS, Atom, and Sitemap feeds
     */
    private probeFeedsAndSitemaps;
    /**
     * Enhanced headless browser interactions for JavaScript-heavy sites
     */
    private performAdvancedInteractions;
    /**
     * Layer 4: Analyze network requests to discover hidden article URLs
     */
    private sniffNetworkRequests;
    /**
     * Check if a URL looks like it might be an article
     */
    private looksLikeArticleUrl;
    /**
     * Extract URLs from JSON-LD data
     */
    private extractUrlsFromJson;
    /**
     * Checks if a URL is likely to be an article URL
     */
    private isArticleUrl;
    /**
     * Extract URLs from HTML content
     */
    private extractUrlsFromHtml;
    /**
     * Helper method to extract URLs from the current page state
     */
    private extractUrlsFromPage;
    /**
     * Layer 5: Headless Browser Simulation
     * Simulates user interactions like clicking "Load More" buttons and infinite scroll
     */
    private simulateUserBehavior;
    /**
     * Main entry point for discovering hidden links with JavaScript-heavy site detection
     */
    discoverLinks(directoryUrl: string): Promise<LinkDiscoveryResult>;
}
export {};
//# sourceMappingURL=link-discoverer.d.ts.map