import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import { Document, KnowledgeBaseItem, KnowledgeBaseExport } from '../types/index.js';

export interface ContentCleanerConfig {
  geminiApiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface CleanedContentResult {
  success: boolean;
  cleanedItem?: KnowledgeBaseItem;
  originalDocument?: Document;
  error?: string;
}

export interface ContentCleanerExportResult {
  success: boolean;
  exportData?: KnowledgeBaseExport;
  error?: string;
  savedPath?: string;
}

export class ContentCleaner {
  private ai: GoogleGenAI;
  private model: string;
  private temperature: number;
  private maxOutputTokens: number;

  constructor(config: ContentCleanerConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    this.model = config.model || 'gemini-2.0-flash-001';
    this.temperature = config.temperature || 0.3;
    this.maxOutputTokens = config.maxOutputTokens || 2048;
  }

  /**
   * Clean and enhance a single document using Gemini AI
   */
  async cleanDocument(document: Document, teamId: string, userId?: string): Promise<CleanedContentResult> {
    try {
      logger.info('Starting content cleaning for document', { 
        documentId: document.id, 
        title: document.title,
        contentLength: document.content.length 
      });

      // Prepare the prompt for content cleaning
      const cleaningPrompt = this.buildCleaningPrompt(document);

      // Generate cleaned content using the new API
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: cleaningPrompt,
        config: {
          temperature: this.temperature,
          maxOutputTokens: this.maxOutputTokens,
        }
      });

      const cleanedContent = response.text;

      if (!cleanedContent) {
        return { 
          success: false, 
          error: 'No content returned from Gemini AI',
          originalDocument: document 
        };
      }

      // Parse the cleaned response to extract title and content
      const { title, content, contentType } = this.parseCleanedResponse(cleanedContent, document);

      // Create the cleaned knowledge base item
      const cleanedItem: KnowledgeBaseItem = {
        title: title || document.title,
        content: content,
        content_type: contentType,
        source_url: document.source_url,
        author: document.author,
        user_id: userId
      };

      logger.info('Successfully cleaned document', {
        documentId: document.id,
        originalLength: document.content.length,
        cleanedLength: content.length,
        contentType: contentType
      });

      return { 
        success: true, 
        cleanedItem,
        originalDocument: document 
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during content cleaning';
      logger.error('Content cleaning failed', { 
        documentId: document.id, 
        error: errorMessage 
      });

      return { 
        success: false, 
        error: errorMessage,
        originalDocument: document 
      };
    }
  }

  /**
   * Clean multiple documents and export to the specified format
   */
  async cleanAndExportDocuments(
    documents: Document[], 
    teamId: string, 
    userId?: string,
    outputPath?: string
  ): Promise<ContentCleanerExportResult> {
    try {
      logger.info('Starting bulk content cleaning', { 
        documentCount: documents.length, 
        teamId 
      });

      const cleanedItems: KnowledgeBaseItem[] = [];
      const errors: string[] = [];

      // Process each document
      for (const document of documents) {
        const result = await this.cleanDocument(document, teamId, userId);
        
        if (result.success && result.cleanedItem) {
          cleanedItems.push(result.cleanedItem);
        } else {
          const error = `Failed to clean document ${document.id}: ${result.error}`;
          errors.push(error);
          logger.warn(error);
        }

        // Add a small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Create export data in the specified format
      const exportData: KnowledgeBaseExport = {
        team_id: teamId,
        items: cleanedItems
      };

      // Save to file if output path is provided
      let savedPath: string | undefined;
      if (outputPath) {
        savedPath = await this.saveExportData(exportData, outputPath);
      }

      logger.info('Bulk content cleaning completed', {
        totalDocuments: documents.length,
        successfulCleanings: cleanedItems.length,
        errors: errors.length,
        savedPath
      });

      return {
        success: true,
        exportData,
        ...(savedPath && { savedPath })
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during bulk cleaning';
      logger.error('Bulk content cleaning failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Build the cleaning prompt for Gemini AI
   */
  private buildCleaningPrompt(document: Document): string {
    return `You are a content cleaning and enhancement AI. Your task is to clean, improve, and format scraped web content while preserving all important information and PROPER LINE BREAKS.

**Original Document:**
Title: ${document.title}
Source: ${document.source_url || 'Unknown'}
Author: ${document.author || 'Unknown'}
Content Type: ${document.content_type}

**Content to Clean:**
${document.content}

**CRITICAL FORMATTING INSTRUCTIONS:**
1. Clean up any formatting issues, remove navigation elements, ads, or irrelevant content
2. Improve readability while preserving all important information
3. Maintain the original meaning and structure
4. Convert to clean, well-formatted Markdown with PROPER LINE BREAKS
5. Use proper paragraph breaks (double newlines \\n\\n between paragraphs)
6. Use proper heading structure (# ## ### etc.)
7. Preserve list formatting with proper line breaks
8. Remove any duplicate or redundant content
9. Fix any obvious typos or grammatical errors
10. Keep all technical details, code examples, and important links

**CRITICAL: PRESERVE LINE BREAKS AND PARAGRAPH STRUCTURE**
- Each paragraph must be separated by a blank line (\\n\\n)
- Headings must be on their own lines
- Lists must have proper line breaks between items
- Do NOT put everything on one line
- Maintain readable paragraph structure

**Output Format:**
Please respond with the cleaned content in the following format:

TITLE: [Improved title if needed, or original title]
CONTENT_TYPE: [One of: blog, podcast_transcript, call_transcript, linkedin_post, reddit_comment, book, other]
CONTENT:
[Clean, well-formatted Markdown content with proper line breaks and paragraphs]

**CRITICAL REMINDER:** 
- Only return the content in the specified format above
- Do not add any additional commentary or explanations
- Preserve all important technical information and details
- Make the content more readable but don't change the core message
- MAINTAIN PROPER PARAGRAPH STRUCTURE WITH LINE BREAKS`;
  }

  /**
   * Parse the cleaned response from Gemini AI
   */
  private parseCleanedResponse(cleanedResponse: string, originalDocument: Document): {
    title: string;
    content: string;
    contentType: KnowledgeBaseItem['content_type'];
  } {
    try {
      // Extract title
      const titleMatch = cleanedResponse.match(/TITLE:\s*(.+?)(?:\n|$)/);
      const title = titleMatch?.[1]?.trim() || originalDocument.title;

      // Extract content type
      const contentTypeMatch = cleanedResponse.match(/CONTENT_TYPE:\s*(.+?)(?:\n|$)/);
      const rawContentType = contentTypeMatch?.[1]?.trim().toLowerCase();
      
      // Map to valid content types
      const contentType = this.mapToValidContentType(rawContentType, originalDocument);

      // Extract content - preserve all whitespace and line breaks
      const contentMatch = cleanedResponse.match(/CONTENT:\s*\n([\s\S]*?)$/);
      let content = contentMatch?.[1] || cleanedResponse;
      
      // Clean up the content while preserving structure
      if (content) {
        // Remove excessive blank lines (more than 2 consecutive newlines)
        content = content.replace(/\n{3,}/g, '\n\n');
        
        // Ensure proper paragraph spacing
        content = content.replace(/\n([^\n\s])/g, '\n\n$1');
        
        // Clean up any leading/trailing whitespace while preserving internal structure
        content = content.trim();
        
        // Ensure headings have proper spacing
        content = content.replace(/\n(#+\s)/g, '\n\n$1');
        content = content.replace(/(#+\s[^\n]+)\n([^\n#])/g, '$1\n\n$2');
        
        // Ensure list items have proper spacing
        content = content.replace(/\n([*-]\s)/g, '\n$1');
        
        logger.debug('Content parsing completed', { 
          contentLength: content.length,
          lineBreaks: (content.match(/\n/g) || []).length,
          paragraphs: (content.match(/\n\n/g) || []).length + 1
        });
      } else {
        content = originalDocument.content;
        logger.warn('Failed to extract content from AI response, using original');
      }

      return {
        title,
        content,
        contentType
      };

    } catch (error) {
      logger.warn('Failed to parse cleaned response, using fallback', { error });
      
      return {
        title: originalDocument.title,
        content: this.preserveLineBreaks(cleanedResponse || originalDocument.content),
        contentType: this.mapToValidContentType(undefined, originalDocument)
      };
    }
  }

  /**
   * Ensure content has proper line breaks and formatting
   */
  private preserveLineBreaks(content: string): string {
    if (!content) return content;
    
    // Normalize line endings
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Remove excessive blank lines
    content = content.replace(/\n{3,}/g, '\n\n');
    
    // Ensure sentences that end periods have line breaks if they're run together
    content = content.replace(/(\w\.)\s+([A-Z])/g, '$1\n\n$2');
    
    // Clean up and return
    return content.trim();
  }

  /**
   * Map content type to valid KnowledgeBaseItem content_type
   */
  private mapToValidContentType(
    detectedType: string | undefined, 
    originalDocument: Document
  ): KnowledgeBaseItem['content_type'] {
    if (!detectedType) {
      // Infer from source URL or default to 'blog'
      if (originalDocument.source_url) {
        const url = originalDocument.source_url.toLowerCase();
        if (url.includes('linkedin.com')) return 'linkedin_post';
        if (url.includes('reddit.com')) return 'reddit_comment';
        if (url.includes('podcast') || url.includes('transcript')) return 'podcast_transcript';
      }
      return 'blog';
    }

    // Map detected types to valid types
    const typeMap: Record<string, KnowledgeBaseItem['content_type']> = {
      'blog': 'blog',
      'article': 'blog',
      'post': 'blog',
      'podcast_transcript': 'podcast_transcript',
      'podcast': 'podcast_transcript',
      'transcript': 'podcast_transcript',
      'call_transcript': 'call_transcript',
      'call': 'call_transcript',
      'linkedin_post': 'linkedin_post',
      'linkedin': 'linkedin_post',
      'reddit_comment': 'reddit_comment',
      'reddit': 'reddit_comment',
      'book': 'book',
      'documentation': 'other',
      'docs': 'other',
      'guide': 'other',
      'tutorial': 'other'
    };

    return typeMap[detectedType] || 'other';
  }

  /**
   * Save export data to file
   */
  private async saveExportData(exportData: KnowledgeBaseExport, outputPath: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    
    // Ensure the directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write the JSON file
    const jsonContent = JSON.stringify(exportData, null, 2);
    fs.writeFileSync(outputPath, jsonContent, 'utf8');

    logger.info('Export data saved successfully', { 
      outputPath, 
      itemCount: exportData.items.length 
    });

    return outputPath;
  }

  /**
   * Validate that required environment variables are available
   */
  static validateConfig(): { isValid: boolean; error?: string } {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      return {
        isValid: false,
        error: 'GEMINI_API_KEY environment variable is required'
      };
    }

    return { isValid: true };
  }
} 