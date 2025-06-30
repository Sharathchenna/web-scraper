import { SmartLinkDiscoverer } from './dist/processors/smart-link-discoverer.js';

console.log('🚀 Testing Smart Link Discovery with Probe-and-Decide Logic\n');

// Test different types of websites
const testUrls = [
  {
    name: 'Quill Blog (likely button-gated)',
    url: 'https://quill.org/blog',
    description: 'Modern blog with potential "Load more" buttons'
  },
  {
    name: 'Traditional Blog',
    url: 'https://blog.stripe.com',
    description: 'Traditional blog with static links'
  },
  {
    name: 'Next.js Docs (JS-heavy)',
    url: 'https://nextjs.org/blog',
    description: 'React-based blog with potential interactions'
  }
];

async function testSmartDiscovery() {
  const discoverer = new SmartLinkDiscoverer();
  
  for (const testCase of testUrls) {
    console.log(`\n📋 Testing: ${testCase.name}`);
    console.log(`   URL: ${testCase.url}`);
    console.log(`   Description: ${testCase.description}`);
    console.log('   ⏱️  Running discovery...');
    
    try {
      const startTime = Date.now();
      const result = await discoverer.discover(testCase.url, 10);
      const duration = Date.now() - startTime;
      
      console.log(`   ✅ Completed in ${duration}ms`);
      console.log(`   🔍 Probe Score: ${result.score} (JS-Heavy: ${result.jsHeavy})`);
      console.log(`   📊 Layer Used: ${result.layer} (1=Static, 2=Cheap, 3=Playwright)`);
      console.log(`   🔗 URLs Found: ${result.urls.length}`);
      
      if (result.interactions.length > 0) {
        console.log(`   🖱️  Interactions: ${result.interactions.length}`);
        result.interactions.slice(0, 3).forEach(interaction => {
          console.log(`      • ${interaction}`);
        });
        if (result.interactions.length > 3) {
          console.log(`      ... and ${result.interactions.length - 3} more`);
        }
      }
      
      if (result.urls.length > 0) {
        console.log('   📄 Sample URLs:');
        result.urls.slice(0, 3).forEach(url => {
          console.log(`      • ${url}`);
        });
        if (result.urls.length > 3) {
          console.log(`      ... and ${result.urls.length - 3} more`);
        }
      }
      
      console.log(`   ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
    
    console.log('   ' + '─'.repeat(60));
  }
  
  console.log('\n🎯 Key Features Tested:');
  console.log('  • Quick probe (≤1s) to detect JS-heavy sites');
  console.log('  • Cheap methods first for traditional sites'); 
  console.log('  • Smart escalation to Playwright when needed');
  console.log('  • Button clicking for "Load more", "Read more", etc.');
  console.log('  • Infinite scroll handling');
  console.log('  • Network request monitoring for hidden URLs');
  console.log('  • Comprehensive selector coverage');
}

// Run the test
testSmartDiscovery().catch(console.error); 