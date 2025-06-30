import type { Logger } from 'winston';
import { InteractionConfig } from './interaction-engine.js';
import { AuthConfig } from './auth-engine.js';
interface SmartDiscoveryResult {
    urls: string[];
    interactions: string[];
    success: boolean;
    durationMs: number;
}
export declare class SmartLinkDiscoverer {
    private readonly logger;
    private readonly interactionEngine;
    private readonly authEngine;
    private readonly xmlParser;
    private readonly config;
    private static readonly JS_HEAVY_THRESHOLD;
    private static readonly MAX_SCROLL_ATTEMPTS;
    private static readonly MAX_CLICK_ATTEMPTS;
    private static readonly INTERACTION_TIMEOUT;
    private static readonly NETWORK_TIMEOUT;
    constructor(logger?: Logger, config?: Partial<InteractionConfig & AuthConfig>);
    /**
     * STEP 1: Quick probe to determine if site is JavaScript-heavy (≤1s)
     */
    private quickProbe;
    /**
     * STEP 2: Cheap methods (static scraping, feeds)
     */
    private cheapMethods;
    /**
     * STEP 3: Headless Playwright mode with smart interactions
     */
    private playwrightMode;
    /**
     * PROVEN STRATEGY: Rapid-click all "Read more" buttons to capture navigation URLs
     */
    private clickRevealerButtons;
    /**
     * Perform systematic infinite scroll
     */
    private performInfiniteScroll;
    /**
     * Extract all URLs from current page state
     */
    private harvestAllUrls;
    /**
     * Helper methods
     */
    private extractStaticLinks;
    private probeFeedsAndSitemaps;
    private extractUrlsFromXML;
    private extractUrlsFromJson;
    private looksLikeArticleUrl;
    /**
     * MAIN ENTRY POINT: Smart discovery with probe-and-decide logic
     */
    discover(url: string, desiredLinkCount?: number): Promise<SmartDiscoveryResult>;
    private processPage;
    /**
     * Harvest URLs from all frames in the page
     */
    private harvestFrameUrls;
}
export {};
//# sourceMappingURL=smart-link-discoverer.d.ts.map