import { logger } from '../utils/logger.js';
export class SemanticChunker {
    config;
    constructor(config) {
        this.config = config;
    }
    async chunkDocument(document, totalChunks) {
        if (totalChunks && totalChunks > 0) {
            return this.chunkDocumentIntoTotalChunks(document, totalChunks);
        }
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
    async chunkDocumentIntoTotalChunks(document, totalChunks) {
        try {
            logger.debug('Starting document chunking into fixed number of chunks', {
                documentId: document.id,
                totalChunks,
            });
            const words = document.content.split(/\s+/);
            const totalWords = words.length;
            const wordsPerChunk = Math.ceil(totalWords / totalChunks);
            const documentChunks = [];
            for (let i = 0; i < totalChunks; i++) {
                const start = i * wordsPerChunk;
                const end = start + wordsPerChunk;
                const chunkContent = words.slice(start, end).join(' ');
                if (chunkContent.length > 0) {
                    documentChunks.push({
                        id: `${document.id}_chunk_${i}`,
                        content: chunkContent,
                        chunk_index: i,
                        word_count: this.countWords(chunkContent),
                    });
                }
            }
            logger.info('Document successfully chunked into fixed number of chunks', {
                documentId: document.id,
                chunkCount: documentChunks.length,
            });
            return {
                ...document,
                chunks: documentChunks,
            };
        }
        catch (error) {
            logger.error('Error chunking document into fixed number of chunks', {
                documentId: document.id,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
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
        // Enhanced heading detection for both web content and PDF documents
        const headingRegexes = [
            // Standard markdown headers
            /^(#{1,3})\s+(.+)$/gm,
            // PDF/eBook chapter patterns
            /^(CHAPTER\s+\d+[^\n]*?)$/gim,
            /^(Chapter\s+\d+[^\n]*?)$/gim,
            // Numbered sections
            /^(\d+\.\s+[A-Z][^\n]{5,50})$/gm,
            // All caps headings (common in PDFs)
            /^([A-Z][A-Z\s]{2,30}[A-Z])$/gm,
            // Title case headings with optional colon
            /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*:?)$/gm,
        ];
        const allMatches = [];
        // Collect all potential headings
        headingRegexes.forEach((regex, regexIndex) => {
            const matches = Array.from(content.matchAll(regex));
            matches.forEach(match => {
                if (match.index !== undefined) {
                    let headingText = '';
                    let level = 3; // Default level
                    if (regexIndex === 0) {
                        // Markdown headers - extract level and text
                        level = match[1]?.length || 3;
                        headingText = match[2]?.trim() || '';
                    }
                    else {
                        // Other patterns - use the captured group
                        headingText = match[1]?.trim() || '';
                        // Assign levels based on pattern type
                        if (regexIndex <= 2)
                            level = 1; // Chapter patterns
                        else if (regexIndex === 3)
                            level = 2; // Numbered sections
                        else
                            level = 3; // Other headings
                    }
                    if (headingText.length > 0 && this.isValidHeading(headingText)) {
                        allMatches.push({
                            text: headingText,
                            index: match.index,
                            level,
                            type: `pattern_${regexIndex}`
                        });
                    }
                }
            });
        });
        // Sort by position and filter duplicates
        allMatches.sort((a, b) => a.index - b.index);
        const filteredMatches = this.removeDuplicateHeadings(allMatches);
        if (filteredMatches.length < 2) {
            // Not enough headers found, fallback to word count splitting
            return this.splitByWordCount(content);
        }
        const sections = [];
        for (let i = 0; i < filteredMatches.length; i++) {
            const currentMatch = filteredMatches[i];
            const nextMatch = filteredMatches[i + 1];
            if (!currentMatch)
                continue;
            const startIndex = currentMatch.index;
            const endIndex = nextMatch?.index || content.length;
            const sectionContent = content.slice(startIndex, endIndex).trim();
            const wordCount = this.countWords(sectionContent);
            // Only create sections for significant headings or substantial content
            if (currentMatch.level <= 2 || sectionContent.length > 500) {
                if (wordCount > this.config.max_chunk_size) {
                    // Section is too large, split it further
                    const subChunks = this.splitLargeSection(sectionContent, currentMatch.text);
                    sections.push(...subChunks);
                }
                else if (wordCount >= this.config.min_chunk_size) {
                    // Section is good size
                    sections.push({
                        content: sectionContent,
                        chapter: currentMatch.text,
                    });
                }
            }
        }
        return sections.length > 0 ? sections : this.splitByWordCount(content);
    }
    isValidHeading(text) {
        // Filter out false positive headings
        const invalidPatterns = [
            /^\d+$/, // Just numbers
            /^[a-z\s]+$/, // All lowercase (likely not a heading)
            /[.]{2,}/, // Multiple dots (likely table of contents)
            /page\s+\d+/i, // Page numbers
            /^(the|and|or|but|if|when|where|why|how|what|who)$/i, // Common words
        ];
        return text.length >= 3 &&
            text.length <= 100 &&
            !invalidPatterns.some(pattern => pattern.test(text));
    }
    removeDuplicateHeadings(matches) {
        const filtered = [];
        const seenTexts = new Set();
        for (const match of matches) {
            const normalizedText = match.text.toLowerCase().replace(/[^\w\s]/g, '');
            // Skip if we've seen this heading text before (within close proximity)
            let isDuplicate = false;
            for (const seen of seenTexts) {
                if (normalizedText === seen ||
                    (normalizedText.includes(seen) && seen.length > 5) ||
                    (seen.includes(normalizedText) && normalizedText.length > 5)) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                filtered.push(match);
                seenTexts.add(normalizedText);
            }
        }
        return filtered;
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