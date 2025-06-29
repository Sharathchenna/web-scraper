import { config } from 'dotenv';
import { AppConfig } from '../types/index.js';

// Load environment variables
config();

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || '0.0.0.0',
    redis_url: process.env.REDIS_URL || 'redis://localhost:6379',
    database_path: process.env.DATABASE_PATH || './data/queue.db',
    output_dir: process.env.OUTPUT_DIR || './output',
    log_level: (process.env.LOG_LEVEL as any) || 'info',
    max_workers: parseInt(process.env.NUM_WORKERS_PER_QUEUE || '4', 10),
    
    firecrawl: {
      api_url: process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev',
      api_key: process.env.FIRECRAWL_API_KEY,
      use_local: process.env.USE_LOCAL_FIRECRAWL === 'true',
      local_url: process.env.LOCAL_FIRECRAWL_URL || 'http://localhost:3002',
    },
    
    chunking: {
      max_chunk_size: parseInt(process.env.MAX_CHUNK_SIZE || '1000', 10),
      min_chunk_size: parseInt(process.env.MIN_CHUNK_SIZE || '100', 10),
      overlap_size: parseInt(process.env.CHUNK_OVERLAP_SIZE || '50', 10),
      split_on_headers: process.env.SPLIT_ON_HEADERS !== 'false',
    },
    
    ai: {
      gemini_api_key: process.env.GEMINI_API_KEY,
      enable_summarization: process.env.ENABLE_AI_SUMMARIZATION === 'true',
      enable_tagging: process.env.ENABLE_AI_TAGGING === 'true',
    },
  };
}

export function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  if (config.port < 1 || config.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (config.max_workers < 1) {
    errors.push('NUM_WORKERS_PER_QUEUE must be at least 1');
  }

  if (!config.firecrawl.use_local && !config.firecrawl.api_key) {
    errors.push('FIRECRAWL_API_KEY is required when not using local Firecrawl');
  }

  if (config.chunking.max_chunk_size < config.chunking.min_chunk_size) {
    errors.push('MAX_CHUNK_SIZE must be greater than MIN_CHUNK_SIZE');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
} 