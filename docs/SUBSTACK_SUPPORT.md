# Substack Support Plan

## 1. Background & Motivation
Substack host thousands of independent newsletters.  Each publication lives on its own sub-domain (e.g. `myblog.substack.com`) and exposes **two** important public surfaces that make scraping trivial **without** executing any client-side JavaScript:

1. A JSON **Archive API**:  `https://<publication>.substack.com/api/v1/archive?sort=new&offset=0&limit=<N>`
2. A JSON **Post API**:   `https://<publication>.substack.com/api/v1/posts/<slug>` _(or `/p/<slug>.json`)_

Both endpoints are unauthenticated for free/public posts and return structured data that includes:
* canonical URL
* full HTML body (render-ready)
* markdown (under `body_markdown`)
* author, tags, publication date, cover image, etc.

Leveraging these endpoints is **faster, cheaper and more reliable** than headless-browser scraping.  We therefore treat Substack as a *first-class* provider in our pipeline.

---

## 2. Pipeline Touch-Points
Below is a concise mapping between pipeline components and the changes required to support Substack.

| Layer | Current File | Change Summary |
|-------|--------------|----------------|
| **Link discovery** | `src/processors/link-discoverer.ts` | 1. Detect `*.substack.com` roots.<br>2. Directly fetch the archive API to enumerate post URLs instead of crawling HTML.<br>3. Push discovered canonical URLs into the queue (respecting `MAX_FEED_ITEMS`). |
| **Extraction strategy** | `src/processors/firecrawl-extractor.ts` | 1. Add `substack.com` to a new strategy "substack-json" that bypasses Firecrawl and calls the Post API.<br>2. Parse JSON → build `Document` using `body_markdown` or `body_html`.<br>3. Populate metadata (`title`, `author`, `date`, `tags`, `description`, `image_url`). |
| **Slug patterns** | `LinkDiscoverer.PLATFORM_PATTERNS` | Add:  `{ prefix: '/p/', separator: '-', hasCategory: false }` for `substack.com`. |
| **Heavy-JS heuristics** | no change | Substack loads fine statically – JavaScript heaviness score remains low. |

> NOTE: We deliberately *avoid* Playwright for Substack because the JSON surface is richer and immutable.

---

## 3. Implementation Details
### 3.1 Link Discoverer
```ts
// inside discoverLinks() when host ends with '.substack.com'
const pubDomain = new URL(directoryUrl).hostname;
const archiveUrl = `https://${pubDomain}/api/v1/archive?sort=new&offset=0&limit=${LinkDiscoverer.MAX_FEED_ITEMS}`;
const { posts } = await fetchJson<ArchiveResponse>(archiveUrl);
return {
  urls: posts.map(p => p.canonical_url),
  layer: 0,
  success: true,
};
```
*No Playwright session, no DOM parsing.*

### 3.2 Firecrawl Extractor
```ts
private async extractSubstack(url: string): Promise<ExtractionData> {
  const { hostname, pathname } = new URL(url);
  const slug = pathname.replace(/^\/(p\/)?|\/$/g, '');
  const apiUrl = `https://${hostname}/api/v1/posts/${slug}`;
  const json = await fetchJson<PostResponse>(apiUrl);
  return {
    markdown: json.post.body_markdown,
    html: json.post.body_html,
    metadata: {
      title: json.post.title,
      author: json.post.author?.name,
      date: json.post.published_at,
      description: json.post.subtitle,
      tags: json.post.tags?.map(t => t.name),
      sourceURL: json.post.canonical_url,
    },
    success: true,
  };
}
```
Then, inside `determineExtractionStrategy()`:
```ts
if (domain.endsWith('substack.com')) {
  return { name: 'substack-json', options: {} };
}
```
And at call-site of `scrapeUrl`, short-circuit when strategy is `substack-json` and delegate to `extractSubstack()`.

### 3.3 Error Handling & Paywall
* **Locked Posts** — API returns `401`.  Capture that and mark `error: 'paywalled'` so we can skip or queue for manual review.
* **Soft gated content** — Some publications expose an *excerpt* only.  We use `preview_content: true` flag if available; otherwise fallback to Firecrawl.

---

## 4. Testing Checklist
1. Unit tests (`test/scraper-test-sites.test.ts`)
   * Add fixtures: `https://shreycation.substack.com` and another random Substack.
   * Assert that at least 5 posts are discovered and each `Document` contains non-empty markdown.
2. Manual run:
   ```bash
   npm run cli scrape https://shreycation.substack.com --team dev
   ```
   Validate logs show `strategy: substack-json` and zero Playwright launches.

---

## 5. Future Improvements
* **Authentication** – support passing a session cookie for paid newsletters.
* **Comments Extraction** – Substack exposes `/api/v1/comments` per post.
* **Email Variants** – If the publication disables web access but emails are forwarded, consider IMAP ingestion.

---

## 6. References
* Substack public API reverse-engineering: <https://bowtiedcrawfish.substack.com/p/web-scraping> 
* Article on scraping techniques: <https://mckayjohns.substack.com/p/web-scraping-hacks-that-changed-my>
* Official RSS docs: <https://substack.com/help/reader>  