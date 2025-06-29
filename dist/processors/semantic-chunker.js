import { logger } from '../utils/logger.js';
export class SemanticChunker {
    config;
    constructor(config) {
        this.config = config;
    }
    async chunkDocument(document) {
        try {
            logger.debug('Starting document chunking', {
                documentId: document.id,
                contentLength: document.content.length
            });
            // If document is small enough, no chunking needed
            const wordCount = this.countWords(document.content);
            if (wordCount <= this.config.max_chunk_size) {
                logger.debug('Document is small enough, no chunking needed', {
                    documentId: document.id,
                    wordCount
                });
                return document;
            }
            const chunks = this.splitDocument(document.content);
            const documentChunks = chunks.map((chunk, index) => ({
                id: `${document.id}_chunk_${index}`,
                content: chunk.content,
                chunk_index: index,
                word_count: this.countWords(chunk.content),
                chapter: chunk.chapter || undefined,
                page_range: chunk.pageRange || undefined,
            }));
            logger.info('Document successfully chunked', {
                documentId: document.id,
                originalWordCount: wordCount,
                chunkCount: documentChunks.length,
            });
            return {
                ...document,
                chunks: documentChunks,
            };
        }
        catch (error) {
            logger.error('Error chunking document', {
                documentId: document.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            // Return original document if chunking fails
            return document;
        }
    }
    splitDocument(content) {
        if (this.config.split_on_headers) {
            return this.splitByHeaders(content);
        }
        else {
            return this.splitByWordCount(content);
        }
    }
    splitByHeaders(content) {
        // Try to split by markdown headers
        const headerRegex = /^(#{1,3})\s+(.+)$/gm;
        const matches = Array.from(content.matchAll(headerRegex));
        if (matches.length < 2) {
            // Not enough headers found, fallback to word count splitting
            return this.splitByWordCount(content);
        }
        const sections = [];
        for (let i = 0; i < matches.length; i++) {
            const currentMatch = matches[i];
            const nextMatch = matches[i + 1];
            if (!currentMatch)
                continue;
            const startIndex = currentMatch.index || 0;
            const endIndex = nextMatch?.index || content.length;
            const sectionContent = content.slice(startIndex, endIndex).trim();
            const headerLevel = currentMatch[1]?.length || 1; // Number of # characters
            const headerText = currentMatch[2]?.trim() || '';
            // Only create sections for H1 and H2 headers, or if content is substantial
            if (headerLevel <= 2 || sectionContent.length > 500) {
                const wordCount = this.countWords(sectionContent);
                if (wordCount > this.config.max_chunk_size) {
                    // Section is too large, split it further
                    const subChunks = this.splitLargeSection(sectionContent, headerText);
                    sections.push(...subChunks);
                }
                else if (wordCount >= this.config.min_chunk_size) {
                    // Section is good size
                    sections.push({
                        content: sectionContent,
                        chapter: headerText,
                    });
                }
            }
        }
        return sections.length > 0 ? sections : this.splitByWordCount(content);
    }
    splitByWordCount(content) {
        const words = content.split(/\s+/);
        const chunks = [];
        let currentChunk = [];
        let currentWordCount = 0;
        for (const word of words) {
            currentChunk.push(word);
            currentWordCount++;
            if (currentWordCount >= this.config.max_chunk_size) {
                // Look for a good break point (sentence end)
                const chunkText = currentChunk.join(' ');
                const lastSentenceEnd = this.findLastSentenceEnd(chunkText);
                if (lastSentenceEnd > chunkText.length * 0.7) {
                    // Good break point found
                    const finalChunk = chunkText.substring(0, lastSentenceEnd + 1);
                    const remainder = chunkText.substring(lastSentenceEnd + 1);
                    chunks.push({ content: finalChunk.trim() });
                    // Start next chunk with remainder and overlap
                    currentChunk = this.addOverlap(remainder, words, currentWordCount - this.countWords(remainder));
                    currentWordCount = currentChunk.length;
                }
                else {
                    // No good break point, split at word boundary
                    chunks.push({ content: chunkText });
                    currentChunk = this.createOverlapChunk(currentChunk);
                    currentWordCount = currentChunk.length;
                }
            }
        }
        // Add remaining content
        if (currentChunk.length > 0) {
            const remainingContent = currentChunk.join(' ').trim();
            if (remainingContent.length >= this.config.min_chunk_size * 4) { // Minimum character length
                chunks.push({ content: remainingContent });
            }
            else if (chunks.length > 0) {
                // Merge with last chunk if too small
                const lastChunk = chunks[chunks.length - 1];
                if (lastChunk) {
                    lastChunk.content += ' ' + remainingContent;
                }
            }
            else {
                // Only chunk and it's small, keep it anyway
                chunks.push({ content: remainingContent });
            }
        }
        return chunks;
    }
    splitLargeSection(content, headerText) {
        const baseChunks = this.splitByWordCount(content);
        return baseChunks.map((chunk, index) => {
            const result = {
                content: chunk.content,
            };
            if (index === 0 && headerText) {
                result.chapter = headerText;
            }
            else if (index > 0) {
                result.chapter = `${headerText || 'Section'} (Part ${index + 1})`;
            }
            return result;
        });
    }
    findLastSentenceEnd(text) {
        // Look for sentence endings: . ! ? followed by space or end of string
        const sentenceEnds = ['.', '!', '?'];
        let lastEnd = -1;
        for (let i = text.length - 1; i >= 0; i--) {
            const char = text[i];
            if (char && sentenceEnds.includes(char)) {
                // Check if it's followed by space or end of string
                const nextChar = text[i + 1];
                if (i === text.length - 1 || (nextChar && /\s/.test(nextChar))) {
                    lastEnd = i;
                    break;
                }
            }
        }
        return lastEnd;
    }
    addOverlap(remainder, allWords, currentPosition) {
        const overlapWords = Math.min(this.config.overlap_size, currentPosition);
        const overlapStart = Math.max(0, currentPosition - overlapWords);
        const overlap = allWords.slice(overlapStart, currentPosition);
        const remainderWords = remainder.split(/\s+/).filter(word => word.length > 0);
        return [...overlap, ...remainderWords];
    }
    createOverlapChunk(currentChunk) {
        const overlapSize = Math.min(this.config.overlap_size, currentChunk.length);
        return currentChunk.slice(-overlapSize);
    }
    countWords(text) {
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }
}
//# sourceMappingURL=semantic-chunker.js.map