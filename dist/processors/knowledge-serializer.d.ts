import { Document } from '../types/index.js';
export declare class KnowledgeBaseSerializer {
    private outputDir;
    constructor(outputDir: string);
    serialize(documents: Document[], teamId: string): Promise<string>;
    private getUniqueSourceTypes;
    private getTotalChunks;
    private ensureUniqueFilename;
    private generateSummary;
}
//# sourceMappingURL=knowledge-serializer.d.ts.map