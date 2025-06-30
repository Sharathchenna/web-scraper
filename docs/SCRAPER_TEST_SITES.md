# Public Websites for Scraper Testing

This document lists well-known, purpose-built playground sites that explicitly allow web scraping for learning and tooling validation.  They are grouped by the **scraping challenge** they help you exercise.

> **Always** double-check each site's `robots.txt` and terms of service before scraping, and throttle your requests responsibly.

---

## 1. Static HTML (no JavaScript required)

| Scenario | Site | Notes |
| --- | --- | --- |
| Simple list & pagination | Books to Scrape | https://books.toscrape.com — 1 000 items, 20 per page, no JS [[source](https://toscrape.com/)] |
| Micro-data, multi-page | Quotes (default) | http://quotes.toscrape.com — semantic tags, pagination [[source](https://toscrape.com/)] |
| Single-page dataset | Countries of the World | https://www.scrapethissite.com/pages/simple/ — all rows on one page [[source](https://www.scrapethissite.com/pages/)] |

## 2. Traditional Pagination Links

| Scenario | Site | Notes |
| --- | --- | --- |
| E-commerce with links | WebScraper.io – pagination demo | https://webscraper.io/test-sites/e-commerce/static — standard paginated catalogue [[source](https://webscraper.io/test-sites)] |
| Search + pagination forms | Hockey Teams | https://www.scrapethissite.com/pages/forms/ — HTML forms & result pages [[source](https://www.scrapethissite.com/pages/)] |

## 3. Infinite Scrolling / "Load More" / AJAX

| Scenario | Site | Notes |
| --- | --- | --- |
| Infinite scroll | Quotes — `/scroll` | http://quotes.toscrape.com/scroll — new quotes appended on scroll [[source](https://toscrape.com/)] |
| Delayed JS content | Quotes — `/js-delayed` | http://quotes.toscrape.com/js-delayed?delay=5000 — stresses wait-logic [[source](https://toscrape.com/)] |
| AJAX pagination | WebScraper.io – AJAX demo | https://webscraper.io/test-sites/e-commerce/ajax — 'Next' loads via XHR [[source](https://webscraper.io/test-sites)] |
| "Load more" button | WebScraper.io – load-more demo | https://webscraper.io/test-sites/e-commerce/load-more — explicit button [[source](https://webscraper.io/test-sites)] |
| Scroll-triggered loading | WebScraper.io – scroll demo | https://webscraper.io/test-sites/e-commerce/scroll — items load when viewport nears bottom [[source](https://webscraper.io/test-sites)] |

## 4. Authentication, CSRF, Sessions

| Scenario | Site | Notes |
| --- | --- | --- |
| Form login w/ CSRF | Quotes — `/login` | http://quotes.toscrape.com/login — any creds accepted; shows hidden CSRF token [[source](https://toscrape.com/)] |
| ViewState + AJAX filter | Quotes — `/search.aspx` | http://quotes.toscrape.com/search.aspx — exposes ASP.NET ViewState handling [[source](https://toscrape.com/)] |

## 5. Frames / iFrames

| Scenario | Site | Notes |
| --- | --- | --- |
| Scraping inside frames | "Turtles All the Way Down" | https://www.scrapethissite.com/pages/frames/ — nested frames + iFrames [[source](https://www.scrapethissite.com/pages/)] |

## 6. HTTP & Networking Experiments

| Tooling | URL | Notes |
| --- | --- | --- |
| HTTP verbs, headers, cookies | https://httpbin.org | Echoes request data; useful for proxy / header tests |

---

### Additional Practice Lists

* Medium blog post with more playground sites: https://medium.com/@spaw.co/best-websites-to-practice-web-scraping-9df5d4df4d1 [[source](https://medium.com/@spaw.co/best-websites-to-practice-web-scraping-9df5d4df4d1)]
* ScrapeMe (WordPress) for lightweight HTML pages: https://scrapeme.live/ [[source](https://scrapeme.live/)]

---

#### Usage Tips

1. **Throttling** – Implement polite delays (e.g., 1–2 requests/sec) and incremental backoff.
2. **Error handling** – Simulate network faults using `httpbin.org/status/500` or `/delay/3`.
3. **JavaScript Rendering** – For JS-heavy endpoints, test both headless browsers and your current `SmartLinkDiscoverer` logic.
4. **Monitoring** – Log HTTP status codes and content-length to catch blocking or CAPTCHAs early.

Happy scraping! 