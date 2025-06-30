import { Document } from '../types/index.js';
import { ContentCleanerConfig } from './content-cleaner.js';
export interface SerializerConfig {
    outputDir: string;
    enableCleaning?: boolean;
    cleaningConfig?: ContentCleanerConfig;
}
export declare class KnowledgeBaseSerializer {
    private outputDir;
    private contentCleaner?;
    private enableCleaning;
    constructor(outputDir: string, config?: Partial<SerializerConfig>);
    serialize(documents: Document[], teamId: string, userId?: string): Promise<string>;
    /**
     * Fallback serialization without content cleaning
     */
    private fallbackSerialization;
    /**
     * Preserve content formatting and line breaks even without AI cleaning
     */
    private preserveContentFormatting;
    /**
     * Enhanced content type mapping with URL-based detection
     */
    private mapContentType;
    private generateSummary;
    private getTotalChunks;
    private ensureUniqueFilename;
    /**
     * Quick serialization method for immediate cleaning and export
     */
    serializeWithCleaning(documents: Document[], teamId: string, userId?: string, outputPath?: string): Promise<string>;
    /**
     * Check if content cleaning is available
     */
    isCleaningEnabled(): boolean;
    /**
     * Get cleaning configuration validation
     */
    static validateCleaningSetup(): {
        isValid: boolean;
        error?: string;
    };
}
//# sourceMappingURL=knowledge-serializer.d.ts.map