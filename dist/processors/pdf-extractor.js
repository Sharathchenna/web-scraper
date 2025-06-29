import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
export class PDFExtractor {
    async extractFromPDF(filePath, config) {
        try {
            logger.info('Starting PDF extraction', { filePath });
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                const error = `PDF file not found: ${filePath}`;
                logger.error(error);
                return { success: false, error };
            }
            // Read PDF file
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdf(dataBuffer);
            if (!pdfData.text || pdfData.text.trim().length === 0) {
                const error = 'No text content found in PDF';
                logger.error(error, { filePath });
                return { success: false, error };
            }
            // Simple extraction for now - create single document
            const document = {
                id: this.generateDocumentId(filePath, 0),
                title: path.basename(filePath, '.pdf'),
                content: this.formatAsMarkdown(pdfData.text),
                content_type: 'markdown',
                source_url: filePath,
                date_scraped: new Date().toISOString(),
                metadata: this.createMetadata(config.team_id, pdfData.text, filePath),
            };
            logger.info('Successfully extracted PDF content', {
                filePath,
                pages: pdfData.numpages,
                textLength: pdfData.text.length,
            });
            return { success: true, documents: [document] };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('PDF extraction error', { filePath, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
    formatAsMarkdown(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\f/g, '\n\n')
            .replace(/(.)\n([a-z])/g, '$1 $2')
            .trim();
    }
    createMetadata(teamId, content, filePath) {
        const wordCount = this.countWords(content);
        return {
            team_id: teamId,
            source_type: 'pdf',
            word_count: wordCount,
            reading_time_minutes: Math.max(1, Math.ceil(wordCount / 200)),
            description: `PDF content from ${path.basename(filePath)}`,
            language: 'en',
        };
    }
    countWords(text) {
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }
    generateDocumentId(filePath, chunkIndex) {
        const fileName = path.basename(filePath);
        const fileHash = Buffer.from(fileName).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
        return `pdf_${fileHash}_${chunkIndex}_${Date.now()}`;
    }
}
//# sourceMappingURL=pdf-extractor.js.map