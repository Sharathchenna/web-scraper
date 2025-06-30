export interface Document {
    id: string;
    title: string;
    content: string;
    content_type: 'markdown' | 'text' | 'html';
    source_url?: string;
    author?: string;
    date_published?: string | undefined;
    date_scraped: string;
    metadata: DocumentMetadata;
    chunks?: DocumentChunk[];
}
export interface DocumentMetadata {
    team_id: string;
    source_type: 'blog' | 'pdf' | 'url';
    word_count: number;
    reading_time_minutes: number;
    tags?: string[];
    description?: string;
    language?: string;
    domain?: string;
}
export interface DocumentChunk {
    id: string;
    content: string;
    chunk_index: number;
    page_range?: string | undefined;
    chapter?: string | undefined;
    word_count: number;
}
export interface CrawlJob {
    id: string;
    url: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    retry_count: number;
    error_message?: string | undefined;
    created_at: string;
    updated_at: string;
    team_id: string;
    depth: number;
    parent_url?: string | undefined;
}
export interface CrawlResult {
    url: string;
    success: boolean;
    document?: Document;
    error?: string;
    links_found?: string[];
}
export interface IngestorConfig {
    team_id: string;
    max_depth: number;
    max_pages: number;
    request_delay: number;
    user_agent: string;
    output_dir: string;
}
export interface BlogIngestorConfig extends IngestorConfig {
    root_url: string;
    follow_rss: boolean;
    domain_filter: boolean;
}
export interface PDFIngestorConfig extends IngestorConfig {
    file_path: string;
    chunk_by_pages: boolean;
    pages_per_chunk: number;
    total_chunks?: number;
}
export interface ProcessorResult {
    success: boolean;
    documents: Document[];
    errors: string[];
    stats: ProcessingStats;
}
export interface ProcessingStats {
    total_pages: number;
    successful_extractions: number;
    failed_extractions: number;
    total_chunks: number;
    processing_time_ms: number;
}
export interface AppConfig {
    port: number;
    host: string;
    redis_url: string;
    database_path: string;
    output_dir: string;
    log_level: 'error' | 'warn' | 'info' | 'debug';
    max_workers: number;
    firecrawl: FirecrawlConfig;
    chunking: ChunkingConfig;
    ai: AIConfig;
}
export interface FirecrawlConfig {
    api_url: string;
    api_key?: string | undefined;
    use_local: boolean;
    local_url?: string | undefined;
}
export interface ChunkingConfig {
    max_chunk_size: number;
    min_chunk_size: number;
    overlap_size: number;
    split_on_headers: boolean;
}
export interface AIConfig {
    gemini_api_key?: string | undefined;
    enable_summarization: boolean;
    enable_tagging: boolean;
}
export interface KnowledgeBaseItem {
    title: string;
    content: string;
    content_type: 'blog' | 'podcast_transcript' | 'call_transcript' | 'linkedin_post' | 'reddit_comment' | 'book' | 'other';
    source_url: string | undefined;
    author: string | undefined;
    user_id: string | undefined;
}
export interface KnowledgeBaseExport {
    team_id: string;
    items: KnowledgeBaseItem[];
}
//# sourceMappingURL=index.d.ts.map