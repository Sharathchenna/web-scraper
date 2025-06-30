# Roadmap: Closing Feature Gaps in SmartLinkDiscoverer

This document proposes an incremental plan to make the scraper **fully pass** every scenario listed in `docs/SCRAPER_TEST_SITES.md`.

---

## Key Gaps Identified

| Gap | Impact | Priority |
| --- | --- | --- |
| 1. Traditional pagination (`Next`, `→`, page=X) is ignored | Stops after the first listing page | 🔴 High |
| 2. "Load more" / AJAX buttons not clicked | Dynamic lists never reveal further items | 🔴 High |
| 3. Login + CSRF–protected directories | Blocks anything behind dummy form | 🟠 Medium |
| 4. iFrame / frame-embedded links | Inner content never harvested | 🟠 Medium |
| 5. Throttling & retry strategy | Risk of 429 / blocking during stress tests | 🟡 Low |

---

## Phase 1 — Pagination & "Load More"

1. **Refactor interaction selector engine**  
   • Promote `INTERACTION_SELECTORS` to its own helper so both `clickRevealerButtons()` and upcoming pagination logic share it.
2. **Implement `clickInteractiveElements()`**  
   a. Iterate over `loadMore`, `pagination`, and existing `readMore` selector groups.  
   b. For each element:
      - `scrollIntoViewIfNeeded()` → `element.click()` (fallback: `page.goto()` if an `<a>` with `href`).  
      - `Promise.race` between network idle and a 3 s timeout to avoid hanging.  
   c. After every interaction, re-harvest URLs and remember visited elements via `WeakSet` to avoid duplicates.
3. **Loop depth**  
   • Allow *up to N* pagination hops (configurable, default 3) to prevent infinite crawls.
4. **Unit tests**  
   • Add Jest mocks with static HTML for `Next` links and dynamic `Load more` increments.

## Phase 2: Simple Auth/CSRF Handling ✅

Status: Completed

Implemented a robust authentication engine that handles:
- Login form detection using common selectors
- CSRF token extraction and handling
- Configurable retry attempts and timeouts
- Proper error handling and logging
- Integration with the existing interaction engine

Key features:
- Centralized login form selectors for common patterns
- Smart CSRF token detection and handling
- Configurable authentication settings via AuthConfig
- Comprehensive test coverage with Jest
- Proper TypeScript types and interfaces

The authentication engine is designed to:
1. Detect login forms using a comprehensive set of selectors
2. Extract and handle CSRF tokens if present
3. Attempt login with provided credentials
4. Re-harvest URLs after successful authentication
5. Handle failures gracefully with configurable retries

Usage example:
```typescript
const authConfig = {
  username: process.env.SITE_USERNAME,
  password: process.env.SITE_PASSWORD,
  maxAttempts: 2,
  networkTimeout: 30000,
  throttleMs: 1000
};

const authEngine = new AuthEngine(logger, authConfig);
const result = await authEngine.handleAuthentication(page);

if (result.success) {
  console.log('Successfully authenticated');
  // Continue with scraping
} else {
  console.log('Authentication failed:', result.error);
}
```

## Phase 3: iFrame & Frame Harvesting ✅

Status: Completed

Implemented a robust frame harvesting system that:
1. Iterates over all frames in the page using `page.frames()`
2. Extracts URLs from anchor elements in each frame
3. Handles cross-origin frame access gracefully
4. Processes JSON-LD data in frames for additional URLs
5. Integrates with the existing URL discovery pipeline

Key features:
- Comprehensive frame content extraction
- Cross-origin error handling
- JSON-LD support in frames
- Proper TypeScript types and interfaces
- Full test coverage with Jest

The frame harvesting system is designed to:
1. Skip the main frame (already processed)
2. Extract URLs from anchor elements
3. Process JSON-LD data in frames
4. Handle cross-origin access errors gracefully
5. Log all interactions for debugging

Usage example:
```typescript
const frameResults = await smartLinkDiscoverer.harvestFrameUrls(page, baseUrl);
console.log(`Found ${frameResults.urls.length} URLs in frames`);
console.log('Frame interactions:', frameResults.interactions);
```

## Phase 4 — Throttling, Retries & Config Surface

* Expose `maxPaginationHops`, `maxLoadMoreClicks`, and `throttleMs` in constructor.  
* Before *any* click/scroll network action, `await page.waitForTimeout(throttleMs)`.
* Back-off on `429` by doubling `throttleMs` up to a ceiling.

---

## Testing Matrix

| Site / Scenario | Static | Pagination | Load More | Infinite Scroll | Login | Frames |
| --------------- | :---: | :---: | :---: | :---: | :---: | :---: |
| Books-to-Scrape | ✓ | ✓ | n/a | n/a | n/a | n/a |
| WebScraper.io (pagination) | ✓ | ✓ | n/a | n/a | n/a | n/a |
| WebScraper.io (load-more) | ✓ | n/a | ✓ | n/a | n/a | n/a |
| WebScraper.io (scroll) | ✓ | n/a | n/a | ✓ | n/a | n/a |
| Quotes `/login` | ✓ | n/a | n/a | n/a | ✓ | n/a |
| Scrape This Site frames demo | ✓ | n/a | n/a | n/a | n/a | ✓ |

CI should run this matrix headless with Playwright.

---

## Deliverables Checklist

- [ ] New helper: `interaction-engine.ts` (selector constants + driver)
- [ ] Updated `SmartLinkDiscoverer` using the helper for pagination/load-more
- [ ] Auth flow detection + dummy-login logic
- [ ] Frame harvesting function
- [ ] Config additions with sane defaults
- [ ] Jest tests for pagination & load-more
- [ ] Playwright e2e tests against public demo sites (behind `--ci` flag)
- [ ] Documentation updates here + README badges for coverage

---

### Timeline (ideal)

| Week | Goal |
| ---- | ---- |
| 1 | Phase 1 implementation & unit tests |
| 2 | Phase 2 auth flow + tests |
| 3 | Phase 3 frames + perf review |
| 4 | Phase 4 throttling & full CI matrix |

> Once these tasks are merged, we can mark every row in `docs/SCRAPER_TEST_SITES.md` as "supported". 