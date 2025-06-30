#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { KnowledgeImporter } from './core/knowledge-importer.js';
import { loadConfig, validateConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import path from 'path';
import fs from 'fs';
import { GoogleDriveDownloader } from './utils/google-drive-downloader.js';
import { FirecrawlExtractor } from './processors/firecrawl-extractor.js';
import { PDFExtractor } from './processors/pdf-extractor.js';
import { LinkDiscoverer } from './processors/link-discoverer.js';
import { SmartLinkDiscoverer } from './processors/smart-link-discoverer.js';
import { ContentCleaner } from './processors/content-cleaner.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('scrape')
  .description('Aline Knowledge Importer - Automatically ingest technical knowledge from blogs, guides, and PDFs')
  .version('1.0.0');

// Single URL extraction command (like Firecrawl's "Single URL" option)
program
  .command('single <url>')
  .description('Extract content from a single URL (like Firecrawl Single URL)')
  .requiredOption('--team <teamId>', 'Team ID for the knowledge base')
  .option('--user <userId>', 'User ID for the knowledge base items')
  .option('--output <dir>', 'Output directory for results')
  .option('--verbose', 'Enable verbose logging')
  .action(async (url, options) => {
    const spinner = ora('Initializing single URL extraction...').start();
    
    try {
      // Load and validate configuration
      const config = loadConfig();
      validateConfig(config);
      
      if (options.verbose) {
        logger.level = 'debug';
      }

      if (options.output) {
        config.output_dir = options.output;
      }

      const importer = new KnowledgeImporter(config);
      await importer.init();

      spinner.text = 'Starting enhanced URL extraction...';
      
      const result = await importer.extractSingleUrl(url, options.team, options.user);

      if (result.success) {
        spinner.succeed(chalk.green(`✅ Successfully extracted content from URL`));
        
        if (result.documents && result.documents.length > 0) {
          const doc = result.documents[0];
          if (doc) {
            console.log(chalk.blue(`📄 Title: ${doc.title}`));
            console.log(chalk.blue(`📝 Word count: ${doc.metadata.word_count}`));
            console.log(chalk.blue(`⏱️  Reading time: ${doc.metadata.reading_time_minutes} minutes`));
          }
        }
        
        if (result.output_file) {
          console.log(chalk.blue(`💾 Output saved to: ${result.output_file}`));
        }

        if (result.stats) {
          console.log(chalk.cyan('\n📊 Extraction Statistics:'));
          console.log(`  • Content extracted: ${result.stats.successful_extractions > 0 ? 'Yes' : 'No'}`);
          console.log(`  • Total chunks created: ${result.stats.total_chunks}`);
          console.log(`  • Processing time: ${(result.stats.processing_time_ms / 1000).toFixed(2)}s`);
        }
      } else {
        spinner.fail(chalk.red(`❌ Extraction failed: ${result.error}`));
        process.exit(1);
      }

    } catch (error) {
      spinner.fail(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      logger.error('CLI error', { error });
      process.exit(1);
    }
  });

// Website crawling command (like Firecrawl's "Crawl" option)
program
  .command('crawl <rootUrl>')
  .description('Crawl a website starting from the root URL (like Firecrawl Crawl for blogs/multi-page sites)')
  .requiredOption('--team <teamId>', 'Team ID for the knowledge base')
  .option('--user <userId>', 'User ID for the knowledge base items')
  .option('--depth <depth>', 'Maximum crawl depth', '3')
  .option('--max-pages <pages>', 'Maximum number of pages to crawl', '50')
  .option('--exclude <patterns...>', 'Patterns to exclude from crawling')
  .option('--include <patterns...>', 'Patterns to include in crawling')
  .option('--output <dir>', 'Output directory for results')
  .option('--verbose', 'Enable verbose logging')
  .action(async (rootUrl, options) => {
    const spinner = ora('Initializing website crawler...').start();
    
    try {
      // Load and validate configuration
      const config = loadConfig();
      validateConfig(config);
      
      if (options.verbose) {
        logger.level = 'debug';
      }

      if (options.output) {
        config.output_dir = options.output;
      }

      const importer = new KnowledgeImporter(config);
      await importer.init();

      spinner.text = 'Starting website crawl...';
      
      const result = await importer.crawlWebsite({
        root_url: rootUrl,
        team_id: options.team,
        user_id: options.user,
        max_depth: parseInt(options.depth),
        max_pages: parseInt(options.maxPages),
        exclude_patterns: options.exclude || [],
        include_patterns: options.include || [],
      });

      if (result.success) {
        spinner.succeed(chalk.green(`✅ Successfully crawled ${result.documents?.length || 0} documents`));
        
        if (result.output_file) {
          console.log(chalk.blue(`📄 Output saved to: ${result.output_file}`));
        }

        if (result.stats) {
          console.log(chalk.cyan('\n📊 Crawl Statistics:'));
          console.log(`  • Total pages processed: ${result.stats.total_pages}`);
          console.log(`  • Successful extractions: ${result.stats.successful_extractions}`);
          console.log(`  • Failed extractions: ${result.stats.failed_extractions}`);
          console.log(`  • Total chunks created: ${result.stats.total_chunks}`);
          console.log(`  • Processing time: ${(result.stats.processing_time_ms / 1000).toFixed(2)}s`);
        }
      } else {
        spinner.fail(chalk.red(`❌ Crawl failed: ${result.error}`));
        process.exit(1);
      }

    } catch (error) {
      spinner.fail(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      logger.error('CLI error', { error });
      process.exit(1);
    }
  });

// Legacy URL command for backward compatibility (now recommends using single/crawl)
program
  .command('url <rootUrl>')
  .description('⚠️  DEPRECATED: Use "single" for single URLs or "crawl" for multi-page sites')
  .requiredOption('--team <teamId>', 'Team ID for the knowledge base')
  .option('--depth <depth>', 'Maximum crawl depth', '2')
  .option('--max-pages <pages>', 'Maximum number of pages to crawl', '50')
  .option('--exclude <patterns...>', 'Patterns to exclude from crawling')
  .option('--include <patterns...>', 'Patterns to include in crawling')
  .option('--output <dir>', 'Output directory for results')
  .option('--verbose', 'Enable verbose logging')
  .action(async (rootUrl, options) => {
    console.log(chalk.yellow('⚠️  DEPRECATED: The "url" command is deprecated.'));
    console.log(chalk.yellow('💡 Use "scrape single <url>" for single URLs or "scrape crawl <url>" for multi-page sites.\n'));
    
    const spinner = ora('Initializing crawler...').start();
    
    try {
      // Load and validate configuration
      const config = loadConfig();
      validateConfig(config);
      
      if (options.verbose) {
        logger.level = 'debug';
      }

      if (options.output) {
        config.output_dir = options.output;
      }

      const importer = new KnowledgeImporter(config);
      await importer.init();

      const maxPages = parseInt(options.maxPages);
      
      // Use enhanced single URL extraction for individual URLs
      if (maxPages === 1) {
        spinner.text = 'Starting enhanced URL extraction...';
        
        const result = await importer.extractSingleUrl(rootUrl, options.team);

        if (result.success) {
          spinner.succeed(chalk.green(`✅ Successfully extracted content from URL`));
          
          if (result.documents && result.documents.length > 0) {
            const doc = result.documents[0];
            if (doc) {
              console.log(chalk.blue(`📄 Title: ${doc.title}`));
              console.log(chalk.blue(`📝 Word count: ${doc.metadata.word_count}`));
              console.log(chalk.blue(`⏱️  Reading time: ${doc.metadata.reading_time_minutes} minutes`));
            }
          }
          
          if (result.output_file) {
            console.log(chalk.blue(`💾 Output saved to: ${result.output_file}`));
          }

          if (result.stats) {
            console.log(chalk.cyan('\n📊 Extraction Statistics:'));
            console.log(`  • Content extracted: ${result.stats.successful_extractions > 0 ? 'Yes' : 'No'}`);
            console.log(`  • Total chunks created: ${result.stats.total_chunks}`);
            console.log(`  • Processing time: ${(result.stats.processing_time_ms / 1000).toFixed(2)}s`);
          }
        } else {
          spinner.fail(chalk.red(`❌ Extraction failed: ${result.error}`));
          process.exit(1);
        }
      } else {
        // Use traditional crawl mode for multiple pages
        spinner.text = 'Starting website crawl...';
        
        const result = await importer.crawlWebsite({
          root_url: rootUrl,
          team_id: options.team,
          max_depth: parseInt(options.depth),
          max_pages: maxPages,
          exclude_patterns: options.exclude || [],
          include_patterns: options.include || [],
        });

        if (result.success) {
          spinner.succeed(chalk.green(`✅ Successfully crawled ${result.documents?.length || 0} documents`));
          
          if (result.output_file) {
            console.log(chalk.blue(`📄 Output saved to: ${result.output_file}`));
          }

          if (result.stats) {
            console.log(chalk.cyan('\n📊 Crawl Statistics:'));
            console.log(`  • Total pages processed: ${result.stats.total_pages}`);
            console.log(`  • Successful extractions: ${result.stats.successful_extractions}`);
            console.log(`  • Failed extractions: ${result.stats.failed_extractions}`);
            console.log(`  • Total chunks created: ${result.stats.total_chunks}`);
            console.log(`  • Processing time: ${(result.stats.processing_time_ms / 1000).toFixed(2)}s`);
          }
        } else {
          spinner.fail(chalk.red(`❌ Crawl failed: ${result.error}`));
          process.exit(1);
        }
      }

    } catch (error) {
      spinner.fail(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      logger.error('CLI error', { error });
      process.exit(1);
    }
  });

// PDF scraping command
program
  .command('pdf <filePath>')
  .description('Extract content from a PDF file using a hybrid chunking strategy')
  .requiredOption('--team <teamId>', 'Team ID for the knowledge base')
  .option('--output <dir>', 'Output directory for results')
  .option('--verbose', 'Enable verbose logging')
  .action(async (filePath, options) => {
    const spinner = ora('Initializing PDF extractor...').start();
    
    try {
      // Load and validate configuration
      const config = loadConfig();
      validateConfig(config);
      
      if (options.verbose) {
        logger.level = 'debug';
      }

      if (options.output) {
        config.output_dir = options.output;
      }

      // Validate file exists or is a Google Drive URL
      const isGoogleDriveLink = filePath.includes('drive.google.com');
      let resolvedPath = filePath;

      if (isGoogleDriveLink) {
        spinner.text = 'Downloading PDF from Google Drive...';
        resolvedPath = await GoogleDriveDownloader.downloadPublicFile(
          filePath,
          config.output_dir
        );
      } else {
        resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`PDF file not found: ${resolvedPath}`);
        }
      }

      spinner.text = 'Extracting PDF content...';
      
      const importer = new KnowledgeImporter(config);
      await importer.init();

      const result = await importer.processPDF({
        file_path: resolvedPath,
        team_id: options.team,
        chunk_by_pages: false,
        pages_per_chunk: 5,
      });

      if (result.success) {
        spinner.succeed(chalk.green(`✅ Successfully processed PDF`));
        
        if (result.output_file) {
          console.log(chalk.blue(`📄 Output saved to: ${result.output_file}`));
        }

        if (result.stats) {
          console.log(chalk.cyan('\n📊 Processing Statistics:'));
          console.log(`  • Total chunks created: ${result.stats.total_chunks}`);
          console.log(`  • Processing time: ${(result.stats.processing_time_ms / 1000).toFixed(2)}s`);
        }
      } else {
        spinner.fail(chalk.red(`❌ PDF processing failed: ${result.error}`));
        process.exit(1);
      }

    } catch (error) {
      spinner.fail(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      logger.error('CLI error', { error });
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show crawler status and statistics')
  .option('--team <teamId>', 'Filter by team ID')
  .action(async (options) => {
    try {
      const config = loadConfig();
      const importer = new KnowledgeImporter(config);
      await importer.init();

      const stats = await importer.getStats(options.team);
      
      console.log(chalk.cyan('📊 Crawler Statistics:'));
      console.log(`  • Total jobs: ${stats.total}`);
      console.log(`  • Pending: ${chalk.yellow(stats.pending)}`);
      console.log(`  • Processing: ${chalk.blue(stats.processing)}`);
      console.log(`  • Completed: ${chalk.green(stats.completed)}`);
      console.log(`  • Failed: ${chalk.red(stats.failed)}`);

    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// Clean command
program
  .command('clean')
  .description('Clean up old completed jobs')
  .option('--days <days>', 'Remove jobs older than N days', '7')
  .action(async (options) => {
    const spinner = ora('Cleaning up old jobs...').start();
    
    try {
      const config = loadConfig();
      const importer = new KnowledgeImporter(config);
      await importer.init();

      const removedCount = await importer.cleanup(parseInt(options.days));
      
      spinner.succeed(chalk.green(`✅ Removed ${removedCount} old jobs`));

    } catch (error) {
      spinner.fail(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// Link discovery command
program
  .command('discover')
  .description('Discover links from a website')
  .requiredOption('-u, --url <url>', 'Website URL to discover links from')
  .option('-o, --output <path>', 'Output directory', './output')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    try {
      logger.info('Starting link discovery', { url: options.url });

      const discoverer = new LinkDiscoverer();
      const result = await discoverer.discoverLinks(options.url);

      const outputPath = path.join(options.output, `links_${Date.now()}.json`);
      const fs = await import('fs');
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      
      logger.info('Link discovery completed', { 
        outputPath,
        linkCount: result.urls.length,
        success: result.success
      });
    } catch (error) {
      logger.error('CLI error', { error });
      process.exit(1);
    }
  });

// Smart link discovery command
program
  .command('smart-discover')
  .description('Smart discovery of content links from a website')
  .requiredOption('-u, --url <url>', 'Website URL to discover links from')
  .option('-c, --count <number>', 'Desired number of links to discover', '10')
  .option('-o, --output <path>', 'Output directory', './output')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    try {
      logger.info('Starting smart link discovery', { url: options.url });

      const discoverer = new SmartLinkDiscoverer();
      const result = await discoverer.discover(options.url, parseInt(options.count));

      if (result.success) {
        const outputPath = path.join(options.output, `smart_links_${Date.now()}.json`);
        const fs = await import('fs');
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        
        logger.info('Smart link discovery completed', { 
          outputPath,
          linkCount: result.urls.length,
          durationMs: result.durationMs
        });
      } else {
        logger.error('Smart link discovery failed');
        process.exit(1);
      }
    } catch (error) {
      logger.error('CLI error', { error });
      process.exit(1);
    }
  });

// AI Content Enhancement command
program
  .command('enhance')
  .description('Clean and enhance scraped content using Gemini AI')
  .requiredOption('-i, --input <path>', 'Input JSON file with scraped documents')
  .requiredOption('-t, --team-id <team-id>', 'Team ID for the content')
  .option('-u, --user-id <user-id>', 'User ID for the content')
  .option('-o, --output <path>', 'Output file path', `./output/enhanced_${Date.now()}.json`)
  .option('-m, --model <model>', 'Gemini model to use', 'gemini-2.0-flash-001')
  .option('--temperature <number>', 'Temperature for content generation', '0.3')
  .option('--max-tokens <number>', 'Maximum output tokens', '2048')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    const spinner = ora('Initializing content enhancement...').start();
    
    if (options.verbose) {
      logger.level = 'debug';
    }

    try {
      // Validate Gemini API key
      const validation = ContentCleaner.validateConfig();
      if (!validation.isValid) {
        spinner.fail(chalk.red(`❌ Configuration error: ${validation.error}`));
        console.log(chalk.yellow('💡 Make sure to set GEMINI_API_KEY in your environment'));
        process.exit(1);
      }

      spinner.text = 'Reading input documents...';
      
      // Read input documents
      if (!fs.existsSync(options.input)) {
        spinner.fail(chalk.red(`❌ Input file does not exist: ${options.input}`));
        process.exit(1);
      }

      const inputData = JSON.parse(fs.readFileSync(options.input, 'utf8'));
      let documents = Array.isArray(inputData) ? inputData : [inputData];

      if (documents.length === 0) {
        spinner.fail(chalk.red('❌ No documents found in input file'));
        process.exit(1);
      }

      spinner.text = `Enhancing ${documents.length} documents with Gemini AI...`;

      // Initialize content cleaner
      const cleaner = new ContentCleaner({
        geminiApiKey: process.env.GEMINI_API_KEY!,
        model: options.model,
        temperature: parseFloat(options.temperature),
        maxOutputTokens: parseInt(options.maxTokens)
      });

      // Clean and export documents
      const result = await cleaner.cleanAndExportDocuments(
        documents,
        options.teamId,
        options.userId,
        options.output
      );

      if (result.success) {
        spinner.succeed(chalk.green('✅ Content enhancement completed successfully'));
        
        console.log(chalk.blue(`📄 Enhanced items: ${result.exportData?.items.length || 0}`));
        console.log(chalk.blue(`💾 Output saved to: ${result.savedPath}`));

        // Show content type distribution
        if (result.exportData) {
          const types = result.exportData.items.reduce((acc, item) => {
            acc[item.content_type] = (acc[item.content_type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          console.log(chalk.cyan('\n📊 Content Types:'));
          Object.entries(types).forEach(([type, count]) => {
            console.log(`  • ${type}: ${count} item${count > 1 ? 's' : ''}`);
          });

          // Save detailed summary
          const summaryPath = options.output.replace('.json', '_summary.json');
          const summary = {
            team_id: result.exportData.team_id,
            processed_at: new Date().toISOString(),
            total_items: result.exportData.items.length,
            content_types: types,
            authors: [...new Set(result.exportData.items.map(item => item.author).filter(Boolean))],
            sources: [...new Set(result.exportData.items.map(item => item.source_url).filter(Boolean))],
            enhancement_settings: {
              model: options.model,
              temperature: parseFloat(options.temperature),
              max_tokens: parseInt(options.maxTokens)
            }
          };
          
          fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
          console.log(chalk.blue(`📋 Summary saved to: ${summaryPath}`));
        }
      } else {
        spinner.fail(chalk.red(`❌ Content enhancement failed: ${result.error}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      logger.error('Content enhancement error', { error });
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 