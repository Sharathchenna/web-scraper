import { Document, KnowledgeBaseExport } from '../types/index.js';
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

      // Create knowledge base export structure
      const knowledgeBase: KnowledgeBaseExport = {
        metadata: {
          team_id: teamId,
          export_date: new Date().toISOString(),
          total_documents: documents.length,
          source_types: this.getUniqueSourceTypes(documents),
          version: '1.0.0',
        },
        documents: documents,
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
      const summary = this.generateSummary(knowledgeBase);
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

  private getUniqueSourceTypes(documents: Document[]): string[] {
    const sourceTypes = new Set<string>();
    
    for (const doc of documents) {
      sourceTypes.add(doc.metadata.source_type);
    }
    
    return Array.from(sourceTypes);
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

  private generateSummary(knowledgeBase: KnowledgeBaseExport): string {
    const { metadata, documents } = knowledgeBase;
    
    const totalWords = documents.reduce((sum, doc) => sum + doc.metadata.word_count, 0);
    const totalReadingTime = documents.reduce((sum, doc) => sum + doc.metadata.reading_time_minutes, 0);
    const totalChunks = this.getTotalChunks(documents);
    
    // Group by source type
    const bySourceType = documents.reduce((acc, doc) => {
      const type = doc.metadata.source_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(doc);
      return acc;
    }, {} as Record<string, Document[]>);

    // Group by domain for blog posts
    const byDomain = documents
      .filter(doc => doc.metadata.source_type === 'blog' && doc.metadata.domain)
      .reduce((acc, doc) => {
        const domain = doc.metadata.domain!;
        if (!acc[domain]) {
          acc[domain] = [];
        }
        acc[domain].push(doc);
        return acc;
      }, {} as Record<string, Document[]>);

    let summary = `# Knowledge Base Export Summary

## Metadata
- **Team ID**: ${metadata.team_id}
- **Export Date**: ${metadata.export_date}
- **Total Documents**: ${metadata.total_documents}
- **Source Types**: ${metadata.source_types.join(', ')}
- **Version**: ${metadata.version}

## Content Statistics
- **Total Word Count**: ${totalWords.toLocaleString()} words
- **Estimated Reading Time**: ${Math.round(totalReadingTime)} minutes
- **Total Chunks**: ${totalChunks}
- **Average Words per Document**: ${Math.round(totalWords / documents.length)}

## Source Breakdown
`;

    // Add breakdown by source type
    for (const [sourceType, docs] of Object.entries(bySourceType)) {
      const typeWords = docs.reduce((sum, doc) => sum + doc.metadata.word_count, 0);
      summary += `\n### ${sourceType.toUpperCase()} Sources
- **Document Count**: ${docs.length}
- **Total Words**: ${typeWords.toLocaleString()}
- **Average Words**: ${Math.round(typeWords / docs.length)}
`;

      // Add domain breakdown for blog posts
      if (sourceType === 'blog' && Object.keys(byDomain).length > 0) {
        summary += '\n**By Domain**:\n';
        for (const [domain, domainDocs] of Object.entries(byDomain)) {
          summary += `- ${domain}: ${domainDocs.length} documents\n`;
        }
      }
    }

    // Add document list
    summary += `\n## Document List\n`;
    
    documents.forEach((doc, index) => {
      const chunkInfo = doc.chunks ? ` (${doc.chunks.length} chunks)` : '';
      const authorInfo = doc.author ? ` by ${doc.author}` : '';
      const dateInfo = doc.date_published ? ` (${doc.date_published.split('T')[0]})` : '';
      
      summary += `${index + 1}. **${doc.title}**${authorInfo}${dateInfo}${chunkInfo}\n`;
      summary += `   - Source: ${doc.source_url || doc.metadata.source_type}\n`;
      summary += `   - Words: ${doc.metadata.word_count.toLocaleString()}\n`;
      
      if (doc.metadata.tags && doc.metadata.tags.length > 0) {
        summary += `   - Tags: ${doc.metadata.tags.join(', ')}\n`;
      }
      
      summary += '\n';
    });

    // Add usage instructions
    summary += `## Usage Instructions

This knowledge base export can be imported into the Aline knowledge base service using the following format:

\`\`\`json
{
  "metadata": { ... },
  "documents": [ ... ]
}
\`\`\`

Each document includes:
- Original content in markdown format
- Metadata (word count, reading time, tags, etc.)
- Optional chunks for large documents
- Source attribution and timestamps

The export is ready for immediate import with no additional transformation required.
`;

    return summary;
  }
} 