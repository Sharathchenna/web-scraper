# Enhanced JavaScript-Heavy Site Detection & Interaction System

This document describes the advanced JavaScript-heavy site detection and interaction capabilities that have been added to the Aline Knowledge Importer.

## Overview

The enhanced system automatically detects whether a website is JavaScript-heavy and adapts its link discovery strategy accordingly. For JavaScript-heavy sites, it uses sophisticated browser automation to interact with dynamic elements and reveal hidden content.

## How It Works

### 1. JavaScript Heaviness Detection

The system analyzes websites using multiple indicators to determine if they rely heavily on JavaScript:

#### Detection Criteria (Scoring System)
- **Framework Detection** (25 points each):
  - React framework detection
  - Vue.js framework detection  
  - Angular framework detection
- **Next.js Detection** (20 points):
  - Next.js specific patterns and data
- **Content Analysis** (15 points each):
  - Minimal initial text content (< 500 characters)
  - Few static links found (< 5 links)
- **Dynamic Loading Indicators** (10-15 points):
  - Loading spinners, skeletons, placeholders
  - Dynamic data fetching patterns (fetch, axios, XMLHttpRequest)
  - Virtual/infinite scrolling detection

**Threshold**: Sites scoring ≥50 points are classified as JavaScript-heavy.

### 2. Adaptive Discovery Strategy

Based on the detection results, the system chooses an appropriate strategy:

#### For JavaScript-Heavy Sites (Score ≥ 50)
- **Skip** traditional static analysis methods
- **Jump directly** to advanced browser interactions (Layer 5)
- Use sophisticated click automation and scrolling

#### For Traditional Sites (Score < 50)
- **Progressive discovery** through multiple layers:
  - Layer 1: Static HTML extraction
  - Layer 2: RSS/Sitemap probing 
  - Layer 3: Network request analysis
  - Layer 4: Basic browser simulation

### 3. Advanced Browser Interactions

For JavaScript-heavy sites, the system performs sophisticated interactions:

#### Phase 1: Interactive Element Discovery
Automatically clicks on elements that might reveal more content:

- **Load More Buttons**:
  - `button:has-text("Load more")`
  - `button:has-text("Show more")`
  - `.load-more`, `.show-more`
  - `[data-testid*="load"]`

- **Read More Links**:
  - `a:has-text("Read more")`
  - `button:has-text("Continue reading")`
  - `.read-more`, `.continue-reading`

- **Pagination Controls**:
  - `a:has-text("Next")`, `button:has-text("Next")`
  - `.pagination a`, `.pager a`
  - `[aria-label*="next"]`

- **Expandable Content**:
  - `[aria-expanded="false"]`
  - `details summary`
  - `.expandable`, `.collapsible`

#### Phase 2: Infinite Scroll Simulation
- Automatically scrolls to the bottom of the page
- Waits for new content to load
- Repeats up to 5 times or until no new content appears
- Extracts URLs from newly loaded content

#### Phase 3: Pagination Navigation
- Detects and follows pagination links
- Navigates to next pages automatically
- Extracts content from additional pages

#### Phase 4: AJAX Trigger Activation
- Looks for elements that trigger AJAX loading:
  - `[data-load-more]`, `[data-infinite-scroll]`
  - `.js-load-more`, `.infinite-scroll-trigger`
- Clicks these elements and waits for content

## Implementation Details

### Key Components

1. **`detectJavaScriptHeaviness(url)`**
   - Analyzes site characteristics
   - Returns detection result with score and indicators

2. **`performAdvancedInteractions(page, baseUrl)`**
   - Executes sophisticated browser interactions
   - Returns discovered URLs and interaction log

3. **Enhanced `discoverLinks(directoryUrl)`**
   - Main entry point with intelligent strategy selection
   - Returns comprehensive results including detection info

### Integration with Knowledge Importer

The enhanced system is automatically used when the crawler encounters sites with limited content discovery:

```typescript
// In KnowledgeImporter.trySmartDiscovery()
const discoveryResult = await this.linkDiscoverer.discoverLinks(options.root_url);

if (discoveryResult.jsHeavy) {
  // JavaScript-heavy site detected
  // Advanced interactions were automatically used
}
```

## Usage Examples

### CLI Usage
The enhanced detection works automatically with existing commands:

```bash
# Automatically detects and handles JavaScript-heavy sites
node dist/cli.js crawl https://example.com/blog --team my_team --max-pages 10 --verbose
```

### Programmatic Usage
```typescript
import { LinkDiscoverer } from './processors/link-discoverer.js';

const discoverer = new LinkDiscoverer();
const result = await discoverer.discoverLinks('https://js-heavy-site.com');

console.log('JS-Heavy:', result.jsHeavy);
console.log('URLs found:', result.urls.length);
console.log('Interactions:', result.interactionsPerformed);
```

## Results and Logging

### Detection Results
```typescript
interface LinkDiscoveryResult {
  urls: string[];           // Discovered URLs
  layer: number;           // Discovery layer used (1-5)
  success: boolean;        // Whether discovery was successful
  jsHeavy?: boolean;       // Whether site was detected as JS-heavy
  interactionsPerformed?: string[]; // Log of interactions performed
}
```

### Example Detection Output
```
JavaScript heaviness analysis {
  url: 'https://example.com',
  score: 75,
  threshold: 50,
  indicators: [
    'React framework detected',
    'Minimal initial text content',
    'Dynamic data fetching detected'
  ]
}
```

### Example Interaction Log
```
interactionsPerformed: [
  'Clicked loadMore: button:has-text("Load more")',
  'Infinite scroll attempt 1',
  'Infinite scroll attempt 2',
  'Triggered AJAX loading: [data-load-more]'
]
```

## Benefits

1. **Automatic Adaptation**: No manual configuration needed - the system automatically detects site types
2. **Comprehensive Coverage**: Handles both traditional and modern JavaScript-heavy websites
3. **Intelligent Interactions**: Sophisticated browser automation reveals hidden content
4. **Detailed Logging**: Full visibility into detection reasoning and interactions performed
5. **Fallback Support**: Multiple layers ensure content discovery even if some methods fail

## Performance Considerations

- **Smart Timing**: Only uses browser automation when needed (JS-heavy sites)
- **Interaction Limits**: Limits interactions to prevent infinite loops
- **Timeout Protection**: All operations have appropriate timeouts
- **Resource Management**: Properly closes browser instances

## Questions & Troubleshooting

### Q: How do I know if my site was detected as JavaScript-heavy?
A: Check the logs for "JavaScript-heavy site detected" or look for `jsHeavy: true` in the results.

### Q: What if the detection is wrong?
A: The system has fallback mechanisms. If JS-heavy detection fails, it will fall back to traditional methods.

### Q: Can I adjust the detection threshold?
A: Currently the threshold is set to 50 points. This can be modified in the `JS_HEAVY_THRESHOLD` constant.

### Q: What sites work best with this system?
A: The system excels with:
- Modern React/Vue/Angular blog sites
- Sites with "Load More" buttons
- Infinite scroll implementations
- Dynamic content loading
- Traditional static blogs (automatically detected and handled efficiently)

The enhanced system provides robust, intelligent link discovery that adapts to the specific characteristics of each website, ensuring maximum content extraction success. 