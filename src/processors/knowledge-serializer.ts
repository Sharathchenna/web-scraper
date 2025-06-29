import { Document, KnowledgeBaseExport, KnowledgeBaseItem } from '../types/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export class KnowledgeBaseSerializer {
  constructor(private outputDir: string) {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  async serialize(documents: Document[], teamId: string): Promise<string> {
    try {
      logger.info('Starting knowledge base serialization', {
        documentCount: documents.length,
        teamId,
      });

      // Convert documents to the required format
      const items: KnowledgeBaseItem[] = documents.map(doc => ({
        title: doc.title,
        content: doc.content,
        content_type: this.mapContentType(doc.metadata.source_type),
        source_url: doc.source_url || undefined,
        author: doc.author || undefined,
        user_id: undefined
      }));

      // Create knowledge base export structure
      const knowledgeBase: KnowledgeBaseExport = {
        team_id: teamId,
        items
      };

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const filename = `${teamId}_${timestamp}.json`;
      const filePath = path.join(this.outputDir, filename);

      // Ensure we don't overwrite existing files
      const finalPath = await this.ensureUniqueFilename(filePath);

      // Write to file
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

  private mapContentType(sourceType: string): KnowledgeBaseItem['content_type'] {
    switch (sourceType) {
      case 'blog':
        return 'blog';
      case 'pdf':
        return 'book';
      default:
        return 'other';
    }
  }

  private generateSummary(knowledgeBase: KnowledgeBaseExport, documents: Document[]): string {
    const totalWords = documents.reduce((sum, doc) => sum + doc.metadata.word_count, 0);
    const totalReadingTime = documents.reduce((sum, doc) => sum + doc.metadata.reading_time_minutes, 0);
    const totalChunks = this.getTotalChunks(documents);
    
    // Group by content type
    const byContentType = knowledgeBase.items.reduce((acc, item) => {
      const type = item.content_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(item);
      return acc;
    }, {} as Record<string, KnowledgeBaseItem[]>);

    let summary = `# Knowledge Base Export Summary

## Metadata
- **Team ID**: ${knowledgeBase.team_id}
- **Total Items**: ${knowledgeBase.items.length}
- **Content Types**: ${Object.keys(byContentType).join(', ')}

## Content Statistics
- **Total Word Count**: ${totalWords.toLocaleString()} words
- **Estimated Reading Time**: ${Math.round(totalReadingTime)} minutes
- **Total Chunks**: ${totalChunks}
- **Average Words per Item**: ${Math.round(totalWords / knowledgeBase.items.length)}

## Content Type Breakdown
`;

    // Add breakdown by content type
    for (const [contentType, items] of Object.entries(byContentType)) {
      summary += `\n### ${contentType.toUpperCase()}
- **Item Count**: ${items.length}
`;
    }

    // Add item list
    summary += `\n## Item List\n`;
    
    knowledgeBase.items.forEach((item, index) => {
      const authorInfo = item.author ? ` by ${item.author}` : '';
      
      summary += `${index + 1}. **${item.title}**${authorInfo}\n`;
      if (item.source_url) {
        summary += `   - Source: ${item.source_url}\n`;
      }
      summary += `   - Type: ${item.content_type}\n\n`;
    });

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
} 