import { Document } from '../types/index.js';
export declare class KnowledgeBaseSerializer {
    private outputDir;
    constructor(outputDir: string);
    serialize(documents: Document[], teamId: string): Promise<string>;
    private mapContentType;
    private generateSummary;
    private getTotalChunks;
    private ensureUniqueFilename;
}
//# sourceMappingURL=knowledge-serializer.d.ts.map