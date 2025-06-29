# PDF Chunking – Implementation Options

This document lists **four practical strategies** you can use to turn a long PDF (e.g.
Aline's first eight chapters) into smaller, knowledge-base-ready chunks.  They are
ordered from *quickest to implement* to *most sophisticated*.

---

## Option 1 – Page-based chunking (quick win)

**Idea**: Slice the document every *N* pages (default = 5) before sending the text to
the `SemanticChunker`.

1. Inside `PDFExtractor.extractFromPDF()`:
   ```ts
   const pdfData = await pdf(dataBuffer, { pagerender: renderPageWithIndex });
   // pdfData.pageTexts will now be an array of strings – one per page
   ```
2. Loop through `pdfData.pageTexts` and group them:
   ```ts
   const chunks: Document[] = [];
   for (let i = 0; i < pdfData.pageTexts.length; i += pagesPerChunk) {
     const slice = pdfData.pageTexts.slice(i, i + pagesPerChunk).join('\n');
     chunks.push(makeDoc(slice, i, i + pagesPerChunk - 1));
   }
   ```
3. Return `documents: chunks` instead of a single doc.  The existing `KnowledgeImporter`
   pipeline will serialize them automatically.

**Pros**
•  ~30 LOC change, ready in minutes  
•  Deterministic size ➞ predictable token count

**Cons**
•  Page boundaries don't always map to logical breaks  
•  OCR-heavy PDFs might mix columns across pages

---

## Option 2 – Fixed-count chunking via `total_chunks` (already wired up)

`KnowledgeImporter.processPDF()` already passes `total_chunks` into
`SemanticChunker.chunkDocument(doc, total_chunks)`.

Implementation work: **none** – expose a CLI flag (`--total-chunks 16`) and let the
chunker cut the text into equal-sized word buckets.

**Pros**
•  Zero additional code  
•  Useful when you only care about *≈8* chunks regardless of page length

**Cons**
•  Ignores headings / chapters  
•  Cuts may land in the middle of code blocks or lists

---

## Option 3 – Heading-aware chunking (semantic)

1. Keep the PDF as **one** long markdown string (current behaviour).
2. Enhance `SemanticChunker.splitByHeaders()` to recognise typical e-book
   patterns: `CHAPTER \d+`, `### Exercise`, `## Example`, etc.
3. When a section exceeds `max_chunk_size`, fall back to word-count splitting.

**Pros**
•  Produces the most coherent, human-readable chunks  
•  No dependence on original page layout

**Cons**
•  Needs good regex heuristics; may miss edge-case heading formats  
•  Slightly more development effort (~1 hour)

---

## Option 4 – Hybrid: heading first, page fallback

Combine **Option 3** for primary splits and **Option 1** where headings were not
detected:

```ts
const sections = detectHeadings(txt);
if (sections.length < MIN_SECTIONS) {
  return chunkByPages(txt);
}
```

**Pros**
•  Best of both worlds – logical where possible, safe fallback otherwise

**Cons**
•  Highest complexity (~1.5 hours)  
•  Requires unit tests to ensure determinism

---

## Design Decision Matrix

| Criteria               | Opt 1 | Opt 2 | Opt 3 | Opt 4 |
|------------------------|:----:|:----:|:----:|:----:|
| Dev time (S = ½h)      |  **S** | **S** |  M  |  M+ |
| Content coherence      |  L    |  L    | **H** | **H** |
| Deterministic tokens   | **H** | **H** |  M  |  M  |
| Edge-case resilience   |  M    |  L    |  M  | **H** |

(H = High, M = Medium, L = Low)

---

### Recommended Path

1. **Ship Option 1** today – fastest path to meet Maddie's deadline.
2. Add CLI flags already present:
   ```bash
   scrape pdf <file> --team aline123 \
         --chunk-by-pages --pages-per-chunk 5
   ```
3. When time permits, layer **Option 3** to improve semantic quality.

This staged approach gives immediate functionality while leaving room for future
refinement. 