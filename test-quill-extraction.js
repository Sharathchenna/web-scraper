import { chromium } from 'playwright';

async function testQuillExtraction() {
  console.log('🎯 Testing Quill blog URL extraction approach');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  // Track all navigation URLs
  const capturedUrls = new Set();
  
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/blog/') && !url.endsWith('/blog')) {
      capturedUrls.add(url);
      console.log(`📡 Captured: ${url}`);
    }
  });

  try {
    await page.goto('https://quill.co/blog', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('\n🔍 Strategy: Extract URLs by clicking all buttons rapidly');
    
    // Get all "Read more" buttons at once
    const readMoreButtons = await page.locator('button:has-text("Read more")').all();
    console.log(`Found ${readMoreButtons.length} "Read more" buttons`);
    
    // Click each button briefly to trigger network requests but prevent navigation
    for (let i = 0; i < readMoreButtons.length; i++) {
      try {
        const button = readMoreButtons[i];
        
        console.log(`Clicking button ${i + 1}...`);
        await button.click();
        
        // Brief wait to capture the network request
        await page.waitForTimeout(500);
        
        // If we navigated, go back immediately
        if (page.url() !== 'https://quill.co/blog') {
          console.log('  Navigation detected, going back...');
          await page.goBack();
          await page.waitForLoadState('networkidle', { timeout: 3000 });
        }
        
      } catch (e) {
        console.log(`  Button ${i + 1} failed:`, e.message);
      }
    }
    
    console.log('\n📊 Results:');
    console.log(`Captured URLs: ${capturedUrls.size}`);
    Array.from(capturedUrls).forEach((url, i) => {
      console.log(`${i + 1}. ${url}`);
    });
    
    if (capturedUrls.size > 0) {
      console.log('\n✅ Success! This approach works.');
      console.log('Implementation: Click all buttons rapidly, capture network requests, go back after each navigation.');
    } else {
      console.log('\n❌ No URLs captured via network monitoring.');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

testQuillExtraction().catch(console.error); 