import { Document, KnowledgeBaseExport, KnowledgeBaseItem } from '../types/index.js';
import { ContentCleaner, ContentCleanerConfig } from './content-cleaner.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export interface SerializerConfig {
  outputDir: string;
  enableCleaning?: boolean;
  cleaningConfig?: ContentCleanerConfig;
}

export class KnowledgeBaseSerializer {
  private contentCleaner?: ContentCleaner;
  private enableCleaning: boolean;

  constructor(private outputDir: string, config?: Partial<SerializerConfig>) {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Initialize content cleaning if enabled and API key is available
    this.enableCleaning = config?.enableCleaning ?? true; // Default to enabled
    
    if (this.enableCleaning && process.env.GEMINI_API_KEY) {
      try {
        const cleaningConfig: ContentCleanerConfig = {
          geminiApiKey: process.env.GEMINI_API_KEY,
          ...config?.cleaningConfig
        };
        
        this.contentCleaner = new ContentCleaner(cleaningConfig);
        logger.info('Content cleaning enabled with Gemini AI');
      } catch (error) {
        logger.warn('Failed to initialize content cleaner, proceeding without cleaning', { error });
        this.enableCleaning = false;
      }
    } else if (this.enableCleaning && !process.env.GEMINI_API_KEY) {
      logger.warn('Content cleaning requested but GEMINI_API_KEY not found, proceeding without cleaning');
      this.enableCleaning = false;
    }
  }

  async serialize(documents: Document[], teamId: string, userId?: string): Promise<string> {
    try {
      logger.info('Starting knowledge base serialization with cleaning', {
        documentCount: documents.length,
        teamId,
        cleaningEnabled: this.enableCleaning,
        userId
      });

      let finalItems: KnowledgeBaseItem[];

      if (this.enableCleaning && this.contentCleaner) {
        // Clean content using Gemini AI
        logger.info('Cleaning content using Gemini AI...');
        
        const cleaningResult = await this.contentCleaner.cleanAndExportDocuments(
          documents, 
          teamId, 
          userId
        );

        if (cleaningResult.success && cleaningResult.exportData) {
          finalItems = cleaningResult.exportData.items;
          logger.info('Content cleaning completed successfully', {
            originalCount: documents.length,
            cleanedCount: finalItems.length
          });
        } else {
          logger.warn('Content cleaning failed, falling back to original content', {
            error: cleaningResult.error
          });
          finalItems = this.fallbackSerialization(documents, userId);
        }
      } else {
        // Fallback to original serialization without cleaning
        finalItems = this.fallbackSerialization(documents, userId);
      }

      // Create knowledge base export structure in the exact format requested
      const knowledgeBase: KnowledgeBaseExport = {
        team_id: teamId,
        items: finalItems
      };

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const filename = `${teamId}_${timestamp}.json`;
      const filePath = path.join(this.outputDir, filename);

      // Ensure we don't overwrite existing files
      const finalPath = await this.ensureUniqueFilename(filePath);

      // Write to file in the exact format specified
      await fs.promises.writeFile(
        finalPath,
        JSON.stringify(knowledgeBase, null, 2),
        'utf-8'
      );

      // Generate summary
      const summary = this.generateSummary(knowledgeBase, documents);
      const summaryPath = finalPath.replace('.json', '_summary.md');
      await fs.promises.writeFile(summaryPath, summary, 'utf-8');

      logger.info('Knowledge base serialization completed', {
        outputFile: finalPath,
        summaryFile: summaryPath,
        documentCount: documents.length,
        finalItemCount: finalItems.length,
        cleaningUsed: this.enableCleaning,
        totalChunks: this.getTotalChunks(documents),
      });

      return finalPath;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Knowledge base serialization failed', { 
        error: errorMessage, 
        teamId, 
        documentCount: documents.length 
      });
      throw new Error(`Serialization failed: ${errorMessage}`);
    }
  }

  /**
   * Fallback serialization without content cleaning
   */
  private fallbackSerialization(documents: Document[], userId?: string): KnowledgeBaseItem[] {
    return documents.map(doc => ({
      title: doc.title,
      content: this.preserveContentFormatting(doc.content),
      content_type: this.mapContentType(doc.metadata.source_type, doc.source_url),
      source_url: doc.source_url || undefined,
      author: doc.author || undefined,
      user_id: userId || undefined
    }));
  }

  /**
   * Preserve content formatting and line breaks even without AI cleaning
   */
  private preserveContentFormatting(content: string): string {
    if (!content) return content;
    
    // Normalize line endings
    let formatted = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Remove excessive blank lines (more than 2 consecutive newlines)
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    // Ensure proper paragraph breaks for content that's all on one line
    if (formatted.split('\n').length === 1 && formatted.length > 200) {
      // Split long single-line content into paragraphs at sentence boundaries
      formatted = formatted.replace(/\. ([A-Z])/g, '.\n\n$1');
    }
    
    // Clean up any HTML artifacts that might cause formatting issues
    formatted = formatted.replace(/<[^>]*>/g, ''); // Remove HTML tags
    formatted = formatted.replace(/&nbsp;/g, ' '); // Replace non-breaking spaces
    formatted = formatted.replace(/&amp;/g, '&'); // Replace HTML entities
    formatted = formatted.replace(/&lt;/g, '<');
    formatted = formatted.replace(/&gt;/g, '>');
    formatted = formatted.replace(/&quot;/g, '"');
    
    // Ensure headings have proper spacing if they exist
    formatted = formatted.replace(/\n(#+\s)/g, '\n\n$1');
    formatted = formatted.replace(/(#+\s[^\n]+)\n([^\n#])/g, '$1\n\n$2');
    
    // Clean up and return
    return formatted.trim();
  }

  /**
   * Enhanced content type mapping with URL-based detection
   */
  private mapContentType(sourceType: string, sourceUrl?: string): KnowledgeBaseItem['content_type'] {
    // First try to infer from URL
    if (sourceUrl) {
      const url = sourceUrl.toLowerCase();
      if (url.includes('linkedin.com')) return 'linkedin_post';
      if (url.includes('reddit.com')) return 'reddit_comment';
      if (url.includes('podcast') || url.includes('transcript')) return 'podcast_transcript';
      if (url.includes('call') || url.includes('meeting')) return 'call_transcript';
    }

    // Then fall back to source type mapping
    switch (sourceType) {
      case 'blog':
        return 'blog';
      case 'pdf':
        return 'book';
      default:
        return 'other';
    }
  }

  private generateSummary(knowledgeBase: KnowledgeBaseExport, originalDocuments: Document[]): string {
    const totalWords = originalDocuments.reduce((sum, doc) => sum + doc.metadata.word_count, 0);
    const totalReadingTime = originalDocuments.reduce((sum, doc) => sum + doc.metadata.reading_time_minutes, 0);
    const totalChunks = this.getTotalChunks(originalDocuments);
    
    // Group by content type
    const byContentType = knowledgeBase.items.reduce((acc, item) => {
      const type = item.content_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(item);
      return acc;
    }, {} as Record<string, KnowledgeBaseItem[]>);

    // Count unique authors
    const uniqueAuthors = new Set(
      knowledgeBase.items
        .map(item => item.author)
        .filter(author => author && author.trim() !== '')
    );

    // Count unique sources
    const uniqueSources = new Set(
      knowledgeBase.items
        .map(item => item.source_url)
        .filter(url => url && url.trim() !== '')
    );

    let summary = `# Knowledge Base Export Summary

## Export Information
- **Team ID**: ${knowledgeBase.team_id}
- **Export Date**: ${new Date().toISOString().split('T')[0]}
- **Content Cleaning**: ${this.enableCleaning ? '✅ Enabled (Gemini AI)' : '❌ Disabled'}

## Content Statistics
- **Total Items**: ${knowledgeBase.items.length}
- **Original Documents**: ${originalDocuments.length}
- **Total Word Count**: ${totalWords.toLocaleString()} words
- **Estimated Reading Time**: ${Math.round(totalReadingTime)} minutes
- **Total Chunks**: ${totalChunks}
- **Unique Authors**: ${uniqueAuthors.size}
- **Unique Sources**: ${uniqueSources.size}

## Content Type Distribution
`;

    // Add breakdown by content type
    for (const [contentType, items] of Object.entries(byContentType)) {
      const percentage = ((items.length / knowledgeBase.items.length) * 100).toFixed(1);
      summary += `- **${contentType.replace('_', ' ').toUpperCase()}**: ${items.length} items (${percentage}%)\n`;
    }

    // Add authors if available
    if (uniqueAuthors.size > 0) {
      summary += `\n## Authors\n`;
      Array.from(uniqueAuthors).slice(0, 10).forEach(author => {
        const authorItems = knowledgeBase.items.filter(item => item.author === author);
        summary += `- **${author}**: ${authorItems.length} item${authorItems.length > 1 ? 's' : ''}\n`;
      });
      if (uniqueAuthors.size > 10) {
        summary += `- *...and ${uniqueAuthors.size - 10} more authors*\n`;
      }
    }

    // Add source domains if available
    if (uniqueSources.size > 0) {
      summary += `\n## Source Domains\n`;
      const domains = Array.from(uniqueSources)
        .map(url => {
          try {
            return new URL(url!).hostname;
          } catch {
            return url;
          }
        })
        .filter(domain => domain);
      
      const domainCounts = domains.reduce((acc, domain) => {
        acc[domain!] = (acc[domain!] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      Object.entries(domainCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([domain, count]) => {
          summary += `- **${domain}**: ${count} item${count > 1 ? 's' : ''}\n`;
        });
    }

    // Add item list
    summary += `\n## Content Items\n`;
    
    knowledgeBase.items.forEach((item, index) => {
      const authorInfo = item.author ? ` by ${item.author}` : '';
      const userInfo = item.user_id ? ` (User: ${item.user_id})` : '';
      
      summary += `${index + 1}. **${item.title}**${authorInfo}${userInfo}\n`;
      if (item.source_url) {
        summary += `   - Source: ${item.source_url}\n`;
      }
      summary += `   - Type: ${item.content_type}\n`;
      
      // Show content preview (first 100 characters)
      const preview = item.content.substring(0, 100).replace(/\n/g, ' ').trim();
      summary += `   - Preview: ${preview}${item.content.length > 100 ? '...' : ''}\n\n`;
    });

    if (this.enableCleaning) {
      summary += `\n---
*Note: Content has been automatically cleaned and enhanced using Gemini AI to improve readability and formatting.*`;
    }

    return summary;
  }

  private getTotalChunks(documents: Document[]): number {
    return documents.reduce((total, doc) => total + (doc.chunks?.length || 0), 0);
  }

  private async ensureUniqueFilename(filePath: string): Promise<string> {
    let counter = 1;
    let currentPath = filePath;

    while (fs.existsSync(currentPath)) {
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const dir = path.dirname(filePath);
      currentPath = path.join(dir, `${base}_${counter}${ext}`);
      counter++;
    }

    return currentPath;
  }

  /**
   * Quick serialization method for immediate cleaning and export
   */
  async serializeWithCleaning(
    documents: Document[], 
    teamId: string, 
    userId?: string,
    outputPath?: string
  ): Promise<string> {
    if (!this.contentCleaner) {
      throw new Error('Content cleaning not available. Ensure GEMINI_API_KEY is set.');
    }

    const result = await this.contentCleaner.cleanAndExportDocuments(
      documents,
      teamId,
      userId,
      outputPath
    );

    if (!result.success) {
      throw new Error(`Content cleaning failed: ${result.error}`);
    }

    return result.savedPath || 'Content cleaned successfully';
  }

  /**
   * Check if content cleaning is available
   */
  isCleaningEnabled(): boolean {
    return this.enableCleaning && !!this.contentCleaner;
  }

  /**
   * Get cleaning configuration validation
   */
  static validateCleaningSetup(): { isValid: boolean; error?: string } {
    return ContentCleaner.validateConfig();
  }
} 