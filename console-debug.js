// Simple console debugging script for Quill blog
// Copy and paste this into your browser console when on https://quill.co/blog

console.log('🔍 QUILL BLOG STRUCTURE ANALYSIS\n');

// 1. Basic page info
console.log('📊 PAGE INFO:');
console.log('URL:', window.location.href);
console.log('Title:', document.title);

// 2. Find all "Read more" elements
console.log('\n🔍 "READ MORE" ELEMENTS:');
const readMoreElements = Array.from(document.querySelectorAll('*')).filter(el => 
  el.textContent && el.textContent.toLowerCase().includes('read more')
);

readMoreElements.forEach((el, i) => {
  console.log(`${i + 1}. ${el.tagName} - "${el.textContent.trim()}"`);
  console.log(`   Classes: ${el.className}`);
  console.log(`   ID: ${el.id || 'none'}`);
  console.log(`   Href: ${el.href || 'none'}`);
  console.log(`   OnClick: ${el.onclick ? 'has onclick' : 'no onclick'}`);
  console.log(`   Parent: ${el.parentElement.tagName}.${el.parentElement.className}`);
  console.log('');
});

// 3. Find all existing blog post links
console.log('📄 EXISTING BLOG POST LINKS:');
const blogLinks = Array.from(document.querySelectorAll('a[href]')).filter(link => 
  link.href.includes('/blog/') && !link.href.endsWith('/blog')
);

blogLinks.forEach((link, i) => {
  console.log(`${i + 1}. ${link.href}`);
  console.log(`   Text: "${link.textContent.trim().substring(0, 50)}"`);
});

// 4. Check for article containers
console.log('\n📦 ARTICLE CONTAINERS:');
const containers = document.querySelectorAll('article, .post, .blog-post, [class*="post"], [class*="article"], [data-testid*="post"]');
console.log(`Found ${containers.length} potential containers`);

containers.forEach((container, i) => {
  const links = container.querySelectorAll('a[href]');
  const readMore = container.querySelector('*[text*="read more" i], *[textContent*="Read more" i]');
  console.log(`${i + 1}. ${container.tagName}.${container.className}`);
  console.log(`   Links inside: ${links.length}`);
  console.log(`   Has "Read more": ${readMore ? 'yes' : 'no'}`);
});

// 5. Test clicking the first "Read more" button
console.log('\n🖱️  TESTING CLICK SIMULATION:');
const firstReadMore = readMoreElements[0];
if (firstReadMore) {
  console.log('Found first "Read more" element, preparing to click...');
  
  // Store before state
  const beforeLinks = document.querySelectorAll('a[href*="/blog/"]').length;
  const beforeHTML = document.body.innerHTML.length;
  const beforeURL = window.location.href;
  
  console.log(`Before - URL: ${beforeURL}`);
  console.log(`Before - Blog links: ${beforeLinks}`);
  console.log(`Before - HTML length: ${beforeHTML}`);
  
  // Note: You would manually click here or use this in a browser console
  console.log('\n⚠️  TO TEST: Manually click the first "Read more" button, then run this:');
  console.log(`
// After clicking, run this code:
const afterLinks = document.querySelectorAll('a[href*="/blog/"]').length;
const afterHTML = document.body.innerHTML.length;
const afterURL = window.location.href;

console.log('After - URL:', afterURL);
console.log('After - Blog links:', afterLinks);
console.log('After - HTML length:', afterHTML);

if (afterURL !== '${beforeURL}') {
  console.log('🔄 Navigation occurred!');
} else if (afterHTML !== ${beforeHTML}) {
  console.log('📝 Content changed!');
} else {
  console.log('❌ No changes detected');
}

if (afterLinks > ${beforeLinks}) {
  console.log('🎉 New links found!');
  const newLinks = Array.from(document.querySelectorAll('a[href*="/blog/"]')).slice(${beforeLinks});
  newLinks.forEach(link => console.log('New:', link.href));
}
  `);
}

// 6. Check for JavaScript frameworks
console.log('\n⚛️  FRAMEWORK DETECTION:');
const hasReact = !!(window.React || document.querySelector('[data-reactroot]') || document.querySelector('#__next'));
const hasNext = !!(window.__NEXT_DATA__ || document.querySelector('script[src*="_next"]'));
const hasVue = !!(window.Vue || document.querySelector('[data-v-]'));

console.log(`React detected: ${hasReact}`);
console.log(`Next.js detected: ${hasNext}`);
console.log(`Vue detected: ${hasVue}`);

// 7. Network monitoring setup
console.log('\n📡 NETWORK MONITORING:');
console.log('To monitor network requests, open DevTools > Network tab and watch for:');
console.log('- API calls when clicking "Read more"');
console.log('- JSON responses with blog post data');
console.log('- Route changes in SPA navigation');

console.log('\n✅ Analysis complete! Check the output above for insights.'); 