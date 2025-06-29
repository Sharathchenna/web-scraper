import { Document, ChunkingConfig } from '../types/index.js';
export declare class SemanticChunker {
    private config;
    constructor(config: ChunkingConfig);
    chunkDocument(document: Document): Promise<Document>;
    private splitDocument;
    private splitByHeaders;
    private splitByWordCount;
    private splitLargeSection;
    private findLastSentenceEnd;
    private addOverlap;
    private createOverlapChunk;
    private countWords;
}
//# sourceMappingURL=semantic-chunker.d.ts.map