#!/usr/bin/env node

/**
 * Demo script showing hybrid PDF chunking in action
 * Run with: node demo-hybrid-chunking.js
 */

import { PDFExtractor } from './src/processors/pdf-extractor.js';
import { SemanticChunker } from './src/processors/semantic-chunker.js';
import path from 'path';
import fs from 'fs';

const demoConfig = {
  team_id: 'demo-team',
  max_depth: 1,
  max_pages: 1000,
  request_delay: 0,
  user_agent: 'Demo-Agent',
  output_dir: './demo-output',
  file_path: '',
  chunk_by_pages: false,
  pages_per_chunk: 5,
};

const chunkingConfig = {
  max_chunk_size: 1000,
  min_chunk_size: 100,
  overlap_size: 50,
  split_on_headers: true,
};

async function demonstrateHybridChunking() {
  console.log('🔧 PDF Hybrid Chunking Demo\n');
  
  const pdfExtractor = new PDFExtractor();
  const testPdfPath = path.join('test', 'data', '05-versions-space.pdf');
  
  if (!fs.existsSync(testPdfPath)) {
    console.log('❌ Test PDF not found at:', testPdfPath);
    console.log('📝 Creating a mock demonstration instead...\n');
    
    // Demo with sample content
    await demonstrateWithSampleContent();
    return;
  }

  console.log('📖 Processing PDF:', testPdfPath);
  
  try {
    // Test 1: Automatic hybrid chunking
    console.log('\n🔍 Test 1: Automatic Hybrid Chunking');
    const result1 = await pdfExtractor.extractFromPDF(testPdfPath, {
      ...demoConfig,
      file_path: testPdfPath,
      chunk_by_pages: false, // Let system decide
    });
    
    if (result1.success && result1.documents) {
      console.log(`✅ Created ${result1.documents.length} chunks using automatic detection`);
      result1.documents.forEach((doc, i) => {
        console.log(`   Chunk ${i + 1}: "${doc.title}" (${doc.metadata.word_count} words)`);
      });
    }

    // Test 2: Force page-based chunking
    console.log('\n📄 Test 2: Forced Page-Based Chunking');
    const result2 = await pdfExtractor.extractFromPDF(testPdfPath, {
      ...demoConfig,
      file_path: testPdfPath,
      chunk_by_pages: true,
      pages_per_chunk: 3,
    });
    
    if (result2.success && result2.documents) {
      console.log(`✅ Created ${result2.documents.length} chunks using page-based method`);
      result2.documents.forEach((doc, i) => {
        console.log(`   Chunk ${i + 1}: "${doc.title}" (${doc.metadata.word_count} words)`);
      });
    }

  } catch (error) {
    console.error('❌ Error processing PDF:', error.message);
  }
}

async function demonstrateWithSampleContent() {
  console.log('📝 Demo: Semantic vs Word-Count Chunking\n');
  
  const chunker = new SemanticChunker(chunkingConfig);
  
  // Content with clear headings (should use semantic chunking)
  const structuredContent = `
CHAPTER 1: INTRODUCTION TO ALGORITHMS

This chapter introduces fundamental concepts in algorithm design and analysis. We'll explore basic principles that form the foundation of efficient computing.

Algorithms are step-by-step procedures for solving computational problems. They take input, process it according to defined rules, and produce output.

Chapter 2: Data Structures

Data structures organize and store data in computer memory. The choice of data structure significantly impacts algorithm performance.

Arrays provide constant-time access to elements by index. They store elements in contiguous memory locations.

SORTING ALGORITHMS

Sorting arranges data in a specific order. Common sorting algorithms include bubble sort, merge sort, and quicksort.

Each sorting algorithm has different time and space complexity characteristics.

3. Advanced Topics

This section covers more complex algorithmic concepts including dynamic programming and graph algorithms.

Dynamic programming solves problems by breaking them into smaller subproblems and storing results.
  `.trim();

  // Content without clear headings (should fall back to word-count)
  const unstructuredContent = `
This document contains technical information about software engineering practices. It discusses various methodologies and approaches used in modern development teams. The content flows continuously without clear sectional divisions.

Software engineering involves systematic approaches to designing, developing, and maintaining large-scale software systems. Teams use various methodologies including agile, waterfall, and hybrid approaches depending on project requirements.

Quality assurance plays a crucial role in software development. Testing strategies include unit testing, integration testing, and end-to-end testing. Automated testing frameworks help maintain code quality as projects scale.

Version control systems like Git enable collaborative development. Branching strategies help teams manage feature development and releases effectively.
  `.trim();

  // Test structured content
  console.log('🏗️  Testing Structured Content (with clear headings):');
  const structuredDoc = {
    id: 'demo-1',
    title: 'Structured PDF Content',
    content: structuredContent,
    content_type: 'markdown',
    source_url: 'demo.pdf',
    date_scraped: new Date().toISOString(),
    metadata: {
      team_id: 'demo',
      source_type: 'pdf',
      word_count: structuredContent.split(/\s+/).length,
      reading_time_minutes: 3,
      description: 'Demo content',
      language: 'en',
    },
  };

  const structuredResult = await chunker.chunkDocument(structuredDoc);
  if (structuredResult.chunks) {
    console.log(`✅ Created ${structuredResult.chunks.length} semantic chunks:`);
    structuredResult.chunks.forEach((chunk, i) => {
      const preview = chunk.content.substring(0, 50) + '...';
      const chapter = chunk.chapter ? ` [${chunk.chapter}]` : '';
      console.log(`   ${i + 1}. ${preview}${chapter} (${chunk.word_count} words)`);
    });
  }

  // Test unstructured content
  console.log('\n📄 Testing Unstructured Content (few/no headings):');
  const unstructuredDoc = {
    id: 'demo-2',
    title: 'Unstructured PDF Content',
    content: unstructuredContent,
    content_type: 'markdown',
    source_url: 'demo.pdf',
    date_scraped: new Date().toISOString(),
    metadata: {
      team_id: 'demo',
      source_type: 'pdf',
      word_count: unstructuredContent.split(/\s+/).length,
      reading_time_minutes: 2,
      description: 'Demo content',
      language: 'en',
    },
  };

  const unstructuredResult = await chunker.chunkDocument(unstructuredDoc);
  if (unstructuredResult.chunks) {
    console.log(`✅ Created ${unstructuredResult.chunks.length} word-count based chunks:`);
    unstructuredResult.chunks.forEach((chunk, i) => {
      const preview = chunk.content.substring(0, 50) + '...';
      console.log(`   ${i + 1}. ${preview} (${chunk.word_count} words)`);
    });
  }

  console.log('\n🎯 Summary:');
  console.log('• Structured content → Semantic chunking (preserves chapter boundaries)');
  console.log('• Unstructured content → Word-count chunking (consistent sizes)');
  console.log('• PDF processor automatically chooses the best strategy');
}

// CLI usage examples
function showUsageExamples() {
  console.log('\n📋 CLI Usage Examples:');
  console.log('');
  console.log('# Automatic hybrid chunking (recommended)');
  console.log('npm start pdf path/to/book.pdf --team aline123');
  console.log('');
  console.log('# Force page-based chunking');
  console.log('npm start pdf path/to/book.pdf --team aline123 --chunk-by-pages --pages-per-chunk 5');
  console.log('');
  console.log('# Fixed number of chunks');
  console.log('npm start pdf path/to/book.pdf --team aline123 --total-chunks 8');
  console.log('');
  console.log('# Google Drive PDF');
  console.log('npm start pdf "https://drive.google.com/file/d/..." --team aline123');
}

// Run demo
demonstrateHybridChunking()
  .then(() => {
    showUsageExamples();
    console.log('\n✨ Demo complete! Try the CLI commands above with your own PDFs.');
  })
  .catch(error => {
    console.error('Demo failed:', error);
  }); 