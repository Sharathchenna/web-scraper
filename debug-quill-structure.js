import { chromium } from 'playwright';

async function debugQuillBlogStructure() {
  console.log('🔍 Debugging Quill Blog Structure\n');
  
  const browser = await chromium.launch({ 
    headless: false, // Set to true for headless mode
    slowMo: 1000 // Slow down for debugging
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // Monitor network requests
  page.on('request', request => {
    if (request.url().includes('blog') || request.url().includes('api')) {
      console.log(`📡 REQUEST: ${request.method()} ${request.url()}`);
    }
  });

  page.on('response', response => {
    if (response.url().includes('blog') || response.url().includes('api')) {
      console.log(`📥 RESPONSE: ${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('🌐 Navigating to https://quill.co/blog...');
    await page.goto('https://quill.co/blog', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('\n📊 Initial Page Analysis:');
    
    // Analyze the page structure
    const pageInfo = await page.evaluate(() => {
      // Find "Read more" elements using text content
      const allElements = document.querySelectorAll('button, a');
      const readMoreButtons = Array.from(allElements).filter(el => 
        el.textContent && el.textContent.toLowerCase().includes('read more')
      );
      
      const allLinks = document.querySelectorAll('a[href]');
      const blogLinks = Array.from(allLinks).filter(link => 
        link.href.includes('/blog/') && !link.href.endsWith('/blog')
      );
      
      return {
        url: window.location.href,
        title: document.title,
        readMoreButtonsCount: readMoreButtons.length,
        totalLinksCount: allLinks.length,
        blogLinksCount: blogLinks.length,
        blogLinks: blogLinks.map(link => ({
          href: link.href,
          text: link.textContent?.trim().substring(0, 50)
        }))
      };
    });

    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   "Read more" buttons found: ${pageInfo.readMoreButtonsCount}`);
    console.log(`   Total links: ${pageInfo.totalLinksCount}`);
    console.log(`   Blog post links: ${pageInfo.blogLinksCount}`);
    
    if (pageInfo.blogLinks.length > 0) {
      console.log('\n📄 Existing blog post links found:');
      pageInfo.blogLinks.forEach((link, i) => {
        console.log(`   ${i + 1}. ${link.href}`);
        console.log(`      Text: "${link.text}"`);
      });
    }

    // Try to find "Read more" buttons with more specific debugging
    console.log('\n🔍 Analyzing "Read more" buttons:');
    
    const readMoreAnalysis = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a')).filter(el => 
        el.textContent?.toLowerCase().includes('read more')
      );
      
      return buttons.map((button, index) => ({
        index: index,
        tagName: button.tagName,
        textContent: button.textContent?.trim(),
        href: button.getAttribute('href'),
        className: button.className,
        id: button.id,
        onclick: button.onclick?.toString(),
        parentElement: {
          tagName: button.parentElement?.tagName,
          className: button.parentElement?.className,
          textContent: button.parentElement?.textContent?.trim().substring(0, 100)
        }
      }));
    });

    readMoreAnalysis.forEach(button => {
      console.log(`   Button ${button.index + 1}:`);
      console.log(`     Tag: ${button.tagName}`);
      console.log(`     Text: "${button.textContent}"`);
      console.log(`     Href: ${button.href || 'none'}`);
      console.log(`     Class: ${button.className || 'none'}`);
      console.log(`     ID: ${button.id || 'none'}`);
      console.log(`     OnClick: ${button.onclick ? 'yes' : 'none'}`);
      console.log(`     Parent: ${button.parentElement.tagName}.${button.parentElement.className}`);
      console.log(`     Context: "${button.parentElement.textContent}"`);
      console.log('');
    });

    // Test clicking the first "Read more" button
    if (readMoreAnalysis.length > 0) {
      console.log('🖱️  Testing click on first "Read more" button...');
      
      const beforeClick = await page.evaluate(() => ({
        url: window.location.href,
        linkCount: document.querySelectorAll('a[href*="/blog/"]').length,
        innerHTML: document.body.innerHTML.length
      }));
      
      console.log(`   Before click - URL: ${beforeClick.url}`);
      console.log(`   Before click - Blog links: ${beforeClick.linkCount}`);
      console.log(`   Before click - HTML length: ${beforeClick.innerHTML}`);

             try {
         // Click the first button using a more reliable selector
         const firstButton = await page.locator('button, a').filter({ hasText: 'Read more' }).first();
         await firstButton.click();
         console.log('   ✅ Button clicked successfully');
        
        // Wait for potential changes
        await page.waitForTimeout(3000);
        
        const afterClick = await page.evaluate(() => ({
          url: window.location.href,
          linkCount: document.querySelectorAll('a[href*="/blog/"]').length,
          innerHTML: document.body.innerHTML.length,
          newBlogLinks: Array.from(document.querySelectorAll('a[href*="/blog/"]')).map(link => ({
            href: link.href,
            text: link.textContent?.trim().substring(0, 50)
          }))
        }));
        
        console.log(`   After click - URL: ${afterClick.url}`);
        console.log(`   After click - Blog links: ${afterClick.linkCount}`);
        console.log(`   After click - HTML length: ${afterClick.innerHTML}`);
        
        if (beforeClick.url !== afterClick.url) {
          console.log('   🔄 URL changed - Navigation occurred!');
        } else if (beforeClick.innerHTML !== afterClick.innerHTML) {
          console.log('   📝 Content changed - Dynamic content loaded!');
        } else {
          console.log('   ❌ No changes detected');
        }
        
        if (afterClick.linkCount > beforeClick.linkCount) {
          console.log('\n🎉 New blog links discovered:');
          afterClick.newBlogLinks.slice(beforeClick.linkCount).forEach((link, i) => {
            console.log(`   ${i + 1}. ${link.href}`);
            console.log(`      Text: "${link.text}"`);
          });
        }
        
        // Check if we need to go back
        if (beforeClick.url !== afterClick.url) {
          console.log('   🔙 Going back to main page...');
          await page.goBack();
          await page.waitForTimeout(2000);
        }
        
      } catch (error) {
        console.log(`   ❌ Click failed: ${error.message}`);
      }
    }

    // Additional DOM inspection
    console.log('\n🔬 Additional DOM Analysis:');
    
    const domAnalysis = await page.evaluate(() => {
      // Look for potential containers
      const containers = document.querySelectorAll('article, .post, .blog-post, [class*="post"], [class*="article"]');
      
      // Look for potential navigation elements
      const navElements = document.querySelectorAll('[role="navigation"], nav, .nav, .navigation');
      
      // Check for React/Next.js specific elements
      const reactElements = document.querySelectorAll('[data-reactroot], [data-react-helmet], [id*="__next"]');
      
      return {
        containers: containers.length,
        navElements: navElements.length,
        reactElements: reactElements.length,
        scripts: Array.from(document.querySelectorAll('script[src]')).map(s => s.src).filter(src => src.includes('next') || src.includes('react')),
        dataAttributes: Array.from(document.querySelectorAll('*')).map(el => 
          Array.from(el.attributes).filter(attr => attr.name.startsWith('data-'))
        ).flat().map(attr => attr.name).filter((name, index, arr) => arr.indexOf(name) === index)
      };
    });

    console.log(`   Content containers found: ${domAnalysis.containers}`);
    console.log(`   Navigation elements: ${domAnalysis.navElements}`);
    console.log(`   React elements: ${domAnalysis.reactElements}`);
    console.log(`   Next.js/React scripts: ${domAnalysis.scripts.length}`);
    console.log(`   Data attributes: ${domAnalysis.dataAttributes.slice(0, 10).join(', ')}${domAnalysis.dataAttributes.length > 10 ? '...' : ''}`);

    console.log('\n✅ Debugging complete. Press Ctrl+C to exit or wait for browser to close...');
    
    // Keep browser open for manual inspection
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    await browser.close();
  }
}

// Run the debugging
debugQuillBlogStructure().catch(console.error); 