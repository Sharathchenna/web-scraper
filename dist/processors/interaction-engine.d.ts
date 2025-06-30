import { Page } from 'playwright';
import type { Logger } from 'winston';
export interface InteractionConfig {
    maxPaginationHops: number;
    maxLoadMoreClicks: number;
    maxReadMoreClicks: number;
    throttleMs: number;
    interactionTimeout: number;
    networkTimeout: number;
    backoffMs?: number;
}
export interface InteractionResult {
    urls: string[];
    interactions: string[];
    elementsInteracted: number;
    success: boolean;
}
export interface InteractionStats {
    paginationHops: number;
    loadMoreClicks: number;
    readMoreClicks: number;
    scrollAttempts: number;
    urlsFound: number;
    networkRequests: number;
}
export declare const INTERACTION_SELECTORS: {
    loadMore: string[];
    readMore: string[];
    pagination: string[];
    expandable: string[];
};
export declare class InteractionEngine {
    private visitedElements;
    private logger;
    private config;
    constructor(logger: Logger, config: InteractionConfig);
    /**
     * Perform all interactive element clicks with smart deduplication
     */
    clickInteractiveElements(page: Page, baseUrl: string, harvestUrls: (page: Page, baseUrl: string) => Promise<string[]>, looksLikeArticleUrl: (url: string, baseUrl: string) => boolean): Promise<InteractionResult>;
    /**
     * Handle "Load More" buttons that dynamically load content
     */
    private handleLoadMoreButtons;
    /**
     * Handle traditional pagination links
     */
    private handlePagination;
    /**
     * Handle "Read More" buttons (adapted from existing implementation)
     */
    private handleReadMoreButtons;
}
//# sourceMappingURL=interaction-engine.d.ts.map