# Aline Knowledge Importer – Technical Plan

## 1. Goals

1. Automatically ingest technical knowledge from blogs, guides, and PDFs.
2. Zero site-specific scraping logic – must work out-of-the-box on *most* blogs.
3. Produce Markdown content packaged in the required knowledge-base JSON schema.
4. Provide an easy, end-to-end developer & reviewer experience (CLI / Docker).
5. Be easily extensible for future sources (e.g. podcasts, Notion pages, etc.).

---

## 2. High-Level Architecture

```mermaid
graph TD
    A[Input Source\n(URL or PDF)] --> B[Crawl Manager]
    B -->|enqueue| C[URL Queue]
    C --> D[Worker Pool]
    D -->|HTTP fetch| E{Content Type?}
    E -->|HTML| F[Firecrawl Extractor]
    E -->|PDF| G[PDF Parser]
    F --> H[Normalizer & Metadata Mapper]
    G --> H
    H --> I[Semantic Chunker]
    I --> J[Knowledgebase Serializer\n(JSON + Markdown)]
    J --> K[(Output Folder / S3)]
    subgraph Interface Layer
        L[CLI / REST API] --> B
        J --> L
    end
```

### Component Responsibilities

| Component | Purpose |
|-----------|---------|
| **Crawl Manager** | Seeds initial URLs, respects robots.txt, persists frontier (SQLite) |
| **URL Queue** | Redis/SQLite queue enabling distributed workers |
| **Worker Pool** | Adjustable concurrency, retry & back-off logic |
| **Firecrawl Extractor** | Uses Readability to return Markdown, title, author, date |
| **PDF Parser** | `pdfminer.six` → plain text → lightweight md formatting |
| **Normalizer & Mapper** | Maps extractor output → `{title, content, content_type, ...}` |
| **Semantic Chunker** | Splits long docs at H2 or ~1 000 words; adds `page_range` / `chapter` |
| **Knowledgebase Serializer** | Writes `team_id` bundle JSON (one file per crawl) |
| **CLI / API** | `scrape --url … --team …` or POST `/ingest` for e2e UX |

---

## 3. Data Flow

1. **Seed** – User invokes CLI with a blog root URL *or* PDF path.
2. **Crawl** – Manager scans for same-domain article links (or RSS) & queues them.
3. **Fetch & Extract** – Workers pull from queue, fetch content, delegate to Firecrawl (HTML) or PDF parser.
4. **Normalise** – Raw output converted to unified `Doc` objects.
5. **Chunk** – Oversized docs are split to optimise downstream embeddings.
6. **Serialize** – All docs for the run are emitted to `aline123_2024-06-29.json` (schema-compliant).
7. **Store** – Artefacts saved locally or pushed to S3 / Supabase Storage.

---

## 4. Step-by-Step Implementation Plan

### Phase 0 – Repo Scaffolding (½ day)
1. `pnpm init` (Node 20) or `pip init` (Python 3.11) – pick one; below assumes **Node**.
2. Add `src/` and `docs/` dirs; setup ESLint + Prettier.
3. Install core deps: `firecrawl`, `pdf-parse`, `p-limit`, `commander`, `dotenv`, `lowdb` (SQLite wrapper).
4. Add Dev Container or **Dockerfile** with Node & Chromium for Puppeteer.

### Phase 1 – Core Ingestors (1 day)
1. **BlogIngestor**
   • Accepts `rootUrl` & crawl depth.
   • Discovers RSS (if available) else HTML link crawl.
   • Filters URLs by MIME & path heuristics.
2. **PDFIngestor**
   • Streams PDF, extracts text via `pdf-parse`.
   • Splits chapters with regex on `CHAPTER \d+` or provided page ranges.

### Phase 2 – Processing Pipeline (1 day)
1. Build `CrawlerQueue` (SQLite table) with status flags (`pending`, `done`, `error`).
2. Implement `WorkerPool` using `p-limit` for concurrency & retry w/ exponential back-off.
3. Integrate Firecrawl extraction, map to internal `Doc` model.
4. Add `Normalizer` to set `content_type`, attach `source_url`, `author`, etc.

### Phase 3 – Chunking + Serialization (½ day)
1. Chunker: split on H2 headings else token length.
2. Serializer: group docs under provided `team_id`; emit JSON file.
3. Optionally push to S3 via env flag.

### Phase 4 – CLI / API & DX Polish (½ day)
1. CLI (`bin/scrape.js`) with commands:
   • `scrape url <root> --team <id> --depth 2`
   • `scrape pdf <path> --team <id>`
2. Express.js micro-API: `POST /ingest` with body `{type: 'url'|'pdf', source, team}`.
3. Spinner & coloured logs for progress.

### Phase 5 – Testing & CI (½ day)
1. Integration tests on a set of public blogs (Quill, Medium dev.to, WordPress) → assert ≥1 doc.
2. Jest unit tests for Normalizer & Chunker.
3. GitHub Actions: run tests + `docker build`.

### Phase 6 – Docs & Delivery (½ day)
1. Expand this `TECHNICAL_PLAN.md` with FAQs & troubleshooting.
2. Write `README.md` with one-liner install & usage commands.
3. Ship sample output JSON in `samples/` for quick review.

Total ETA: **~3 days** of focused work.

---

## 5. Extensibility Notes

* Add `SubstackIngestor` inheriting from `BlogIngestor` but seeds via RSS feed (`/feed`).
* Swap queue backend to Redis for distributed crawling.
* Plug-in `Summarizer` (Gemini API) to generate 1-sentence abstracts after Normalizer.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Blog with heavy JS rendering | Use Puppeteer-backed fetch inside Firecrawl worker.
| PDF text order issues | Post-process lines, detect columns, run through `markdownlint`.
| Rate-limit / bans | Configurable delay; honour `Retry-After` headers.
| Large sites (10k+ pages) | Frontier checkpointing + resume flag; ability to set max pages.

---

## 7. Usage Example

```bash
# Ingest a blog
pnpm start scrape url https://interviewing.io/blog --team aline123 --depth 2

# Ingest a PDF
pnpm start scrape pdf ~/Downloads/beyond_cracking_the_coding_interview.pdf --team aline123

# Result
open output/aline123_2024-06-29.json
```

The resulting file is immediately importable into the knowledge-base service with no further transformation.

---

Happy scraping! 🚀

---

## 8. Self-Hosting Firecrawl (Appendix)

Below is a proven, copy-/-paste-ready recipe for spinning up your own Firecrawl instance. Two paths are offered:

* **Docker Compose** – quickest way to be up and crawling.
* **Local development** – ideal if you want to hack on Firecrawl's source.

### 8.1 Prerequisites

* Docker + Docker Compose **or** (Node ≥ 18 + pnpm ≥ 9)
* Redis (bundled via Docker or local install for dev)
* `git`

### 8.2 One-liner Docker Compose (production-style)

```bash
# Clone the repo
git clone https://github.com/mendableai/firecrawl.git
cd firecrawl

# Create .env (root level)
cat > .env <<'EOF'
NUM_WORKERS_PER_QUEUE=8
PORT=3002
HOST=0.0.0.0
REDIS_URL=redis://redis:6379
REDIS_RATE_LIMIT_URL=redis://redis:6379
PLAYWRIGHT_MICROSERVICE_URL=http://playwright-service:3000/html
USE_DB_AUTHENTICATION=false
EOF

# Build & start
docker compose build
docker compose up  # add -d to run detached
```

Access points:

* API – <http://localhost:3002>
* Bull Queue UI – <http://localhost:3002/admin/@/queues>

Test crawl:

```bash
curl -X POST http://localhost:3002/v0/crawl \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://interviewing.io/blog"}'
```

### 8.3 Local development workflow (3 terminals)

```bash
# Clone & install deps
git clone https://github.com/mendableai/firecrawl.git
cd firecrawl
pnpm install

# Copy env template
cp apps/api/.env.example apps/api/.env
# Edit minimal block (REDIS_URL=redis://localhost:6379 etc.)

# Terminal 1 – Redis
redis-server

# Terminal 2 – Workers
cd apps/api
pnpm run workers

# Terminal 3 – API server
cd apps/api
pnpm run start
```

Verify:

```bash
curl http://localhost:3002/test   # → "Hello, world!"
```

### 8.4 Handy tweaks & flags

| Use-case                       | How |
|--------------------------------|-----|
| Enable TypeScript Playwright   | Change `playwright-service` build context → `apps/playwright-service-ts` & set `PLAYWRIGHT_MICROSERVICE_URL=http://localhost:3000/scrape` |
| Proxy / anti-bot               | Add `PROXY_SERVER`, `PROXY_USERNAME`, `PROXY_PASSWORD` in `.env` |
| Verbose logging                | `LOGGING_LEVEL=DEBUG` |
| K8s deployment                 | See `examples/kubernetes-cluster-install/` in repo |

### 8.5 Troubleshooting cheatsheet

* **Supabase client warnings** – Safe to ignore when `USE_DB_AUTHENTICATION=false`.
* **Containers crash** – Check `docker logs <name>`; usually a bad `.env` or Redis path.
* **API timeouts** – Ensure workers are up and Redis reachable.

---

This appendix equips reviewers with a friction-free way to run Firecrawl locally or in Docker, fully aligning with the end-to-end experience goal of the take-home. 