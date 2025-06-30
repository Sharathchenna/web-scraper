# Hidden-Link Discovery Strategy

Some modern blogs (e.g. Quill, Medium, Hashnode) load individual article URLs only after the user clicks a **"Read more"** button or after client-side JavaScript fetches data.  Traditional crawlers miss these posts.  This document describes a scalable, five-layer escalation strategy implemented in the Knowledge Importer to surface those hidden links.

---

## 0  Overview Diagram

```mermaid
flowchart LR
    A[Directory Page<br/>HTML] -->|Layer 1| B(JSON-LD + OG Tags)
    B --> C(RSS / Sitemap)
    C --> D(Heuristic Slugs)
    D --> E(Network-Layer Sniff)
    E --> F(Headless Browser)
    classDef cheap fill:#d4ffd9,color:#000;
    classDef mid fill:#fff9d6,color:#000;
    classDef heavy fill:#ffdde0,color:#000;
    B,C class cheap;
    D,E class mid;
    F class heavy;
```

Escalation continues until ≥ **2 distinct article URLs** are found (or all layers fail).

---

## 1  Layer 1 – Static HTML Hints (Cost 🟢)

| Source | Keys Checked |
|--------|--------------|
| `<script type="application/ld+json">` | `url`, `mainEntityOfPage`, `@id` (when `@type = Article / BlogPosting`) |
| `<meta property="og:url">` | Canonical URL |
| Custom attributes | `data-href`, `data-url`, `onclick="location.href='…'"` |

**Implementation:** extend `extractLinksFromContent()` with regexes + safe JSON parse.

---

## 2  Layer 2 – RSS / Atom / Sitemap Probe (Cost 🟢)

1. Probe common feed paths: `/*rss*.xml`, `/*feed*`, `/sitemap*.xml`.
2. Parse first *N* (`≤ 200`) items with an RSS/Atom/XML parser.
3. Push discovered links into extraction queue.

> Tip  Respect `<lastmod>`; skip articles older than 1 year when `--fresh-only` flag is set.

---

## 3  Layer 3 – Heuristic Slug Reconstruction (Cost 🟡)

1. Extract potential titles from headings, card attributes, `data-article-title`.
2. Convert to slugs (`title → lower → non-alpha strip → hyphens`).
3. Combine with common patterns:
   ```text
   blog/:slug       posts/:slug       articles/:slug
   :slug            :slug/           blog/:slug/
   ```
4. Validate by firing **HEAD** requests (cheap) and discarding `404` / tiny pages (`< 200 chars`).

---

## 4  Layer 4 – Network-Layer Sniff (Cost 🟡)

Scan inline JS for:
```js
fetch("/api/posts")
axios.get('/blog?limit=')
query: { posts { slug } }
```
When found, call the endpoint, parse JSON, build URLs via slug pattern.

---

## 5  Layer 5 – Headless Click Simulation (Cost 🔴)

Run only when previous layers yield ≤ 1 link.

```ts
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(directoryUrl, {waitUntil: 'networkidle'});
await page.$$eval('button,a', els => {
  els.filter(e => /read more/i.test(e.textContent || ''))[0]?.click();
});
await page.waitForTimeout(2000);
return page.url();
```
* Browser workers are pooled; max 3 concurrent instances.
* Result URLs join the same extraction pipeline.

---

## 6  Domain Strategy Cache

SQLite table `domain_strategy(domain TEXT PRIMARY KEY, layer INT, success_rate REAL)` stores the **cheapest successful layer**.  Subsequent crawls for the same domain jump directly to that layer, saving time.

---

## 7  Configuration Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--max-headless` | `3` | Hard-cap concurrent headless browsers |
| `DISABLE_RSS_PROBE` | _unset_ | Skip Layer 2 to reduce outbound requests |
| `FRESH_ONLY_DAYS` | `365` | Ignore articles older than N days |

---

## 8  Testing Matrix

| Blog | Framework | Expected Links | Headless Needed? |
|------|-----------|---------------|------------------|
| quill.co/blog | React / Next 14 | ≥ 5 | ❌ |
| dev.to | Ruby | ≥ 10 | ❌ |
| hashnode.com | Next.js SPA | ≥ 8 | ✅ (rare) |
| medium.com | Ember | ≥ 12 | ✅ (common) |

---

## 9  KPIs & Success Targets

* ≥ **80 %** of target blogs yield ≥ 5 articles with **no headless step**.
* Headless invoked in **< 5 %** of production crawls.
* Average end-to-end crawl time ≤ **30 s** per blog (concurrency 8).

---

## 10  Next Steps

1. Implement JSON-LD & OG parsers (PR ▶ `extractLinksFromContent()`)
2. Build `feed-discoverer.ts` helper and integrate.
3. Expand slug patterns & title extraction sources.
4. Prototype network-sniffer regex module.
5. Add `BrowserWorker` class extending `WorkerPool` with Playwright.
6. Ship integration tests & update CI matrix.

---

*Document generated – 2025-06-29* 