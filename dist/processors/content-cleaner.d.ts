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
export declare class ContentCleaner {
    private ai;
    private model;
    private temperature;
    private maxOutputTokens;
    constructor(config: ContentCleanerConfig);
    /**
     * Clean and enhance a single document using Gemini AI
     */
    cleanDocument(document: Document, teamId: string, userId?: string): Promise<CleanedContentResult>;
    /**
     * Clean multiple documents and export to the specified format
     */
    cleanAndExportDocuments(documents: Document[], teamId: string, userId?: string, outputPath?: string): Promise<ContentCleanerExportResult>;
    /**
     * Build the cleaning prompt for Gemini AI
     */
    private buildCleaningPrompt;
    /**
     * Parse the cleaned response from Gemini AI
     */
    private parseCleanedResponse;
    /**
     * Ensure content has proper line breaks and formatting
     */
    private preserveLineBreaks;
    /**
     * Map content type to valid KnowledgeBaseItem content_type
     */
    private mapToValidContentType;
    /**
     * Save export data to file
     */
    private saveExportData;
    /**
     * Validate that required environment variables are available
     */
    static validateConfig(): {
        isValid: boolean;
        error?: string;
    };
}
//# sourceMappingURL=content-cleaner.d.ts.map