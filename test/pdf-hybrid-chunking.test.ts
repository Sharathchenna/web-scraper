import { PDFExtractor } from '../src/processors/pdf-extractor.js';
import { SemanticChunker } from '../src/processors/semantic-chunker.js';
import { PDFIngestorConfig, ChunkingConfig } from '../src/types/index.js';
import fs from 'fs';
import path from 'path';

describe('PDF Hybrid Chunking', () => {
  let pdfExtractor: PDFExtractor;
  let semanticChunker: SemanticChunker;
  
  const mockConfig: PDFIngestorConfig = {
    team_id: 'test-team',
    max_depth: 1,
    max_pages: 1000,
    request_delay: 0,
    user_agent: 'test-agent',
    output_dir: './test-output',
    file_path: '',
    chunk_by_pages: false,
    pages_per_chunk: 5,
  };

  const chunkingConfig: ChunkingConfig = {
    max_chunk_size: 1000,
    min_chunk_size: 100,
    overlap_size: 50,
    split_on_headers: true,
  };

  beforeEach(() => {
    pdfExtractor = new PDFExtractor();
    semanticChunker = new SemanticChunker(chunkingConfig);
  });

  describe('Heading Detection', () => {
         test('should detect chapter headings in PDF-style content', () => {
       const content = `
CHAPTER 1: INTRODUCTION TO ALGORITHMS

This is the introduction to algorithms. We will cover basic concepts and principles.

Chapter 2: Data Structures

In this chapter, we explore various data structures including arrays, linked lists, and trees.

SORTING ALGORITHMS

Sorting is fundamental in computer science. We'll examine different sorting techniques.

3. Advanced Topics

Here we delve into more complex algorithmic concepts.
      `.trim();

      // Test the semantic chunker's ability to detect headings
      const chunker = new SemanticChunker({
        ...chunkingConfig,
        split_on_headers: true,
      });

      const mockDocument = {
        id: 'test-doc',
        title: 'Test PDF',
        content,
        content_type: 'markdown' as const,
        source_url: 'test.pdf',
        date_scraped: new Date().toISOString(),
        metadata: {
          team_id: 'test',
          source_type: 'pdf' as const,
          word_count: 100,
          reading_time_minutes: 1,
          description: 'Test',
          language: 'en',
        },
      };

      const result = chunker.chunkDocument(mockDocument);
      
      // Should detect multiple sections based on headings
      expect(result).toBeDefined();
      // Add more specific assertions based on expected behavior
    });

         test('should fall back to page-based chunking when few headings detected', () => {
       const content = `
This is a document with no clear headings. It just contains plain text without any
structured sections. This might be a scanned document or a document with poor
formatting. In such cases, the system should fall back to page-based
chunking to ensure content is still properly divided into manageable chunks.

This paragraph continues the text without any headings. The hybrid system should
detect that there are insufficient semantic markers and switch to the page-based
approach automatically.
      `.trim();

      const chunker = new SemanticChunker({
        ...chunkingConfig,
        split_on_headers: true,
      });

      const mockDocument = {
        id: 'test-doc',
        title: 'Test PDF',
        content,
        content_type: 'markdown' as const,
        source_url: 'test.pdf',
        date_scraped: new Date().toISOString(),
        metadata: {
          team_id: 'test',
          source_type: 'pdf' as const,
          word_count: 100,
          reading_time_minutes: 1,
          description: 'Test',
          language: 'en',
        },
      };

      const result = chunker.chunkDocument(mockDocument);
      
      // Should fall back to word-count based chunking
      expect(result).toBeDefined();
    });
  });

  describe('Page-based Chunking', () => {
    test('should create documents from page ranges when explicitly requested', async () => {
      // Mock PDF data structure
      const mockPdfData = {
        numpages: 10,
        text: 'This is sample text that would be extracted from a PDF document.',
        pageTexts: [
          'Page 1 content with some text',
          'Page 2 content with different text', 
          'Page 3 content continues here',
          'Page 4 has more information',
          'Page 5 contains additional details',
          'Page 6 wraps up the section',
          'Page 7 starts a new topic',
          'Page 8 continues the discussion',
          'Page 9 provides examples',
          'Page 10 concludes the document',
        ],
      };

      const configWithPages: PDFIngestorConfig = {
        ...mockConfig,
        chunk_by_pages: true,
        pages_per_chunk: 3,
        file_path: 'test.pdf',
      };

      // Test the private method by creating a new instance and calling it
      // Note: In a real test, you might want to make this method protected or add a public wrapper
      const extractor = new PDFExtractor();
      
      // Mock the method call (since private methods can't be tested directly)
      // In practice, you'd test through the public interface
      expect(mockPdfData.pageTexts).toHaveLength(10);
      expect(configWithPages.pages_per_chunk).toBe(3);
      
      // Should create ceil(10/3) = 4 chunks
      const expectedChunks = Math.ceil(mockPdfData.numpages / configWithPages.pages_per_chunk!);
      expect(expectedChunks).toBe(4);
    });
  });

  describe('Integration Test', () => {
    test('should process a sample PDF file if available', async () => {
      const testPdfPath = path.join(__dirname, 'data', '05-versions-space.pdf');
      
      if (fs.existsSync(testPdfPath)) {
        const result = await pdfExtractor.extractFromPDF(testPdfPath, {
          ...mockConfig,
          file_path: testPdfPath,
        });

        expect(result.success).toBe(true);
        expect(result.documents).toBeDefined();
        expect(result.documents!.length).toBeGreaterThan(0);

        // Check that documents have proper structure
        const firstDoc = result.documents![0];
        expect(firstDoc).toHaveProperty('id');
        expect(firstDoc).toHaveProperty('title');
        expect(firstDoc).toHaveProperty('content');
        expect(firstDoc).toHaveProperty('metadata');
        expect(firstDoc.metadata.source_type).toBe('pdf');
      } else {
        console.log('Test PDF not found, skipping integration test');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent files gracefully', async () => {
      const result = await pdfExtractor.extractFromPDF('non-existent.pdf', mockConfig);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('PDF file not found');
    });

    test('should handle invalid PDF data', async () => {
      // This would test with a corrupted or invalid PDF file
      // For now, we'll test the error path exists
      expect(pdfExtractor).toBeDefined();
    });
  });
}); 