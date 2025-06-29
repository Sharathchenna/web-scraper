import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { Document, DocumentMetadata, PDFIngestorConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { GoogleDriveDownloader } from '../utils/google-drive-downloader.js';

export interface PDFExtractResult {
  success: boolean;
  documents?: Document[];
  error?: string;
}

export class PDFExtractor {
  private readonly MIN_SECTIONS_FOR_SEMANTIC = 3; // Minimum sections needed for semantic chunking

  async extractFromPDF(
    filePath: string,
    config: PDFIngestorConfig
  ): Promise<PDFExtractResult> {
    try {
      let localFilePath = filePath;
      const isGoogleDriveLink = filePath.includes('drive.google.com');

      if (isGoogleDriveLink) {
        logger.info('Google Drive link detected, starting download', { url: filePath });
        try {
          const tempDir = path.join(process.cwd(), 'temp', 'pdf-downloads');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          localFilePath = await GoogleDriveDownloader.downloadPublicFile(filePath, tempDir);
        } catch (downloadError) {
          const errorMessage = downloadError instanceof Error ? downloadError.message : 'Unknown error';
          logger.error('Failed to download from Google Drive', { url: filePath, error: errorMessage });
          return { success: false, error: `Failed to download from Google Drive: ${errorMessage}` };
        }
      } else if (!fs.existsSync(localFilePath)) {
        const error = `PDF file not found: ${localFilePath}`;
        logger.error(error);
        return { success: false, error };
      }

      logger.info('Starting PDF extraction', { filePath: localFilePath });
      logger.debug('Reading PDF file into buffer', { localFilePath });
      
      // Read PDF file with page rendering for hybrid chunking
      const dataBuffer = fs.readFileSync(localFilePath);
      logger.debug('PDF file read into buffer', { bufferLength: dataBuffer.length });
      
      // Extract with page-level information
      const pdfData = await pdf(dataBuffer, {
        // Extract individual page texts for page-based fallback
        pagerender: async (pageData) => {
          const renderOptions = {
            normalizeWhitespace: false,
            disableCombineTextItems: false
          };
          const textContent = await pageData.getTextContent(renderOptions);
          return textContent.items.map((item: any) => item.str).join(' ');
        }
      });
      
      logger.debug('PDF data parsed', { numpages: pdfData.numpages });

      if (!pdfData.text || pdfData.text.trim().length === 0) {
        const error = 'No text content found in PDF';
        logger.error(error, { filePath });
        return { success: false, error };
      }

      // Determine chunking strategy using hybrid approach
      const documents = await this.extractWithHybridChunking(
        pdfData, 
        config, 
        filePath
      );

      logger.info('Successfully extracted PDF content with hybrid chunking', {
        filePath,
        pages: pdfData.numpages,
        documentCount: documents.length,
        textLength: pdfData.text.length,
      });

      return { success: true, documents };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('PDF extraction error', { filePath, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async extractWithHybridChunking(
    pdfData: any, 
    config: PDFIngestorConfig, 
    filePath: string
  ): Promise<Document[]> {
    const fullText = this.formatAsMarkdown(pdfData.text);
    
    // Always try semantic chunking first, it's now the default
    const headingSections = this.detectHeadingSections(fullText);
    
    if (headingSections.length >= this.MIN_SECTIONS_FOR_SEMANTIC) {
      logger.info('Using semantic chunking based on headings', { 
        sectionsFound: headingSections.length 
      });
      return this.createDocumentsFromSections(headingSections, config, filePath);
    }

    // Fallback to page-based chunking
    logger.info('Insufficient headings detected, falling back to page-based chunking', {
      sectionsFound: headingSections.length,
      minRequired: this.MIN_SECTIONS_FOR_SEMANTIC,
      pagesPerChunk: config.pages_per_chunk || 5
    });
    return this.chunkByPages(pdfData, config, filePath);
  }

  private detectHeadingSections(content: string): Array<{
    content: string;
    heading?: string;
    startIndex: number;
    endIndex: number;
  }> {
    // Enhanced heading detection for e-books and technical documents
    const headingPatterns = [
      /^(CHAPTER\s+\d+[^\n]*?)$/gim,           // "CHAPTER 1: Introduction"
      /^(Chapter\s+\d+[^\n]*?)$/gim,           // "Chapter 1: Introduction"
      /^(#{1,2}\s+[^\n]+)$/gm,                 // "# Title" or "## Section"
      /^([A-Z][A-Z\s]{2,30}[A-Z])$/gm,        // "INTRODUCTION" (all caps titles)
      /^(\d+\.\s+[A-Z][^\n]{5,50})$/gm,       // "1. Introduction to Programming"
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*:?)$/gm, // "Introduction:" or "Getting Started"
    ];

    const allMatches: Array<{
      text: string;
      index: number;
      pattern: string;
    }> = [];

    // Collect all heading matches
    headingPatterns.forEach((pattern, patternIndex) => {
      const matches = Array.from(content.matchAll(pattern));
      matches.forEach(match => {
        if (match.index !== undefined && match[1]) {
          allMatches.push({
            text: match[1].trim(),
            index: match.index,
            pattern: `pattern_${patternIndex}`
          });
        }
      });
    });

    // Sort by position in document
    allMatches.sort((a, b) => a.index - b.index);

    // Filter out false positives and create sections
    const sections: Array<{
      content: string;
      heading?: string;
      startIndex: number;
      endIndex: number;
    }> = [];

    for (let i = 0; i < allMatches.length; i++) {
      const currentMatch = allMatches[i];
      const nextMatch = allMatches[i + 1];

      if (!currentMatch) continue;

      const startIndex = currentMatch.index;
      const endIndex = nextMatch?.index || content.length;
      const sectionContent = content.slice(startIndex, endIndex).trim();

      // Validate section - must have substantial content
      const wordCount = this.countWords(sectionContent);
      if (wordCount >= 100) { // Minimum 100 words per section
        sections.push({
          content: sectionContent,
          heading: currentMatch.text,
          startIndex,
          endIndex
        });
      }
    }

    return sections;
  }

  private chunkByPages(
    pdfData: any, 
    config: PDFIngestorConfig, 
    filePath: string
  ): Document[] {
    const pagesPerChunk = config.pages_per_chunk || 5;
    const documents: Document[] = [];
    
    // If we have individual page texts, use them
    if (pdfData.pageTexts && Array.isArray(pdfData.pageTexts)) {
      for (let i = 0; i < pdfData.pageTexts.length; i += pagesPerChunk) {
        const pageSlice = pdfData.pageTexts.slice(i, i + pagesPerChunk);
        const combinedText = pageSlice.join('\n\n').trim();
        
        if (combinedText.length > 0) {
          const startPage = i + 1;
          const endPage = Math.min(i + pagesPerChunk, pdfData.pageTexts.length);
          
          documents.push({
            id: this.generateDocumentId(filePath, documents.length),
            title: `${path.basename(filePath, '.pdf')} (Pages ${startPage}-${endPage})`,
            content: this.formatAsMarkdown(combinedText),
            content_type: 'markdown',
            source_url: filePath,
            date_scraped: new Date().toISOString(),
            metadata: this.createMetadata(config.team_id, combinedText, filePath, `${startPage}-${endPage}`),
          });
        }
      }
    } else {
      // Fallback: split full text evenly
      const totalPages = pdfData.numpages || 1;
      const fullText = pdfData.text;
      const wordsPerPage = Math.ceil(this.countWords(fullText) / totalPages);
      const wordsPerChunk = wordsPerPage * pagesPerChunk;
      
      const words = fullText.split(/\s+/);
      for (let i = 0; i < words.length; i += wordsPerChunk) {
        const wordSlice = words.slice(i, i + wordsPerChunk);
        const chunkText = wordSlice.join(' ').trim();
        
        if (chunkText.length > 0) {
          const estimatedStartPage = Math.floor(i / wordsPerPage) + 1;
          const estimatedEndPage = Math.min(Math.floor((i + wordsPerChunk) / wordsPerPage), totalPages);
          
          documents.push({
            id: this.generateDocumentId(filePath, documents.length),
            title: `${path.basename(filePath, '.pdf')} (Est. Pages ${estimatedStartPage}-${estimatedEndPage})`,
            content: this.formatAsMarkdown(chunkText),
            content_type: 'markdown',
            source_url: filePath,
            date_scraped: new Date().toISOString(),
            metadata: this.createMetadata(config.team_id, chunkText, filePath, `${estimatedStartPage}-${estimatedEndPage}`),
          });
        }
      }
    }

    return documents;
  }

  private createDocumentsFromSections(
    sections: Array<{
      content: string;
      heading?: string;
      startIndex: number;
      endIndex: number;
    }>, 
    config: PDFIngestorConfig, 
    filePath: string
  ): Document[] {
    const documents: Document[] = [];
    
    sections.forEach((section, index) => {
      const title = section.heading 
        ? `${path.basename(filePath, '.pdf')}: ${section.heading}`
        : `${path.basename(filePath, '.pdf')} (Section ${index + 1})`;
        
      documents.push({
        id: this.generateDocumentId(filePath, index),
        title: title,
        content: this.formatAsMarkdown(section.content),
        content_type: 'markdown',
        source_url: filePath,
        date_scraped: new Date().toISOString(),
        metadata: this.createMetadata(config.team_id, section.content, filePath, section.heading),
      });
    });

    return documents;
  }

  private formatAsMarkdown(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\f/g, '\n\n')
      .replace(/(.)\n([a-z])/g, '$1 $2')
      .trim();
  }

  private createMetadata(
    teamId: string,
    content: string,
    filePath: string,
    pageRange?: string
  ): DocumentMetadata {
    const wordCount = this.countWords(content);
    
    return {
      team_id: teamId,
      source_type: 'pdf',
      word_count: wordCount,
      reading_time_minutes: Math.max(1, Math.ceil(wordCount / 200)),
      description: pageRange 
        ? `PDF content from ${path.basename(filePath)} (${pageRange})`
        : `PDF content from ${path.basename(filePath)}`,
      language: 'en',
    };
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private generateDocumentId(filePath: string, chunkIndex: number): string {
    const fileName = path.basename(filePath);
    const fileHash = Buffer.from(fileName).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    return `pdf_${fileHash}_${chunkIndex}_${Date.now()}`;
  }
} 