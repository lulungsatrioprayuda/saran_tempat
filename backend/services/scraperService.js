const puppeteer = require('puppeteer');
const {
  extractCoordinates,
  parseRating,
  parseReviewsCount,
  extractPhoneNumber,
  cleanText,
} = require('../utils/parser');

/**
 * Delay helper
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scrape places from Google Maps based on query and location
 *
 * @param {Object} options
 * @param {string} options.query - Place or business to search (e.g., "coffee shop")
 * @param {string} [options.location] - City or area (e.g., "Jakarta Selatan")
 * @param {number} [options.limit=20] - Maximum number of results to fetch
 * @param {number} [options.hasPhone=0] - If 1, only return places that have a phone number
 * @returns {Promise<Array<Object>>}
 */
async function scrapeGoogleMaps({ query, location, limit = 20, hasPhone = 0 }) {
  const searchQuery = location ? `${query} ${location}` : query;
  const encodedQuery = encodeURIComponent(searchQuery);
  const targetUrl = `https://www.google.com/maps/search/${encodedQuery}?hl=en`;

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });

    const page = await browser.newPage();

    // Set standard desktop viewport and User-Agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Block unnecessary assets (images, fonts, stylesheets) for faster scraping
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`[Scraper] Navigating to: ${targetUrl} (hasPhone filter: ${hasPhone})`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle Google Consent / Cookie dialog if present
    try {
      const consentButtonSelector = 'button[aria-label*="Accept all"], form[action*="consent"] button, button[aria-label*="agree" i]';
      const consentBtn = await page.$(consentButtonSelector);
      if (consentBtn) {
        await consentBtn.click();
        await delay(1000);
      }
    } catch (_) {
      // Ignore consent dialog errors
    }

    // Check if redirected directly to a single place page
    const currentUrl = page.url();
    if (currentUrl.includes('/maps/place/')) {
      console.log('[Scraper] Single place detected directly');
      const singlePlace = await extractSinglePlace(page, currentUrl);
      if (singlePlace) {
        if (hasPhone === 1 && !singlePlace.phone) {
          console.log('[Scraper] Single place has no phone number, returning empty as per filter.');
          return [];
        }
        return [singlePlace];
      }
      return [];
    }

    // Wait for the feed container (Google Maps search results)
    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 12000 });
    } catch (_) {
      const heading = await page.$('h1');
      if (heading) {
        const singlePlace = await extractSinglePlace(page, page.url());
        if (singlePlace) {
          if (hasPhone === 1 && !singlePlace.phone) return [];
          return [singlePlace];
        }
      }
      console.log('[Scraper] No feed found or no results returned.');
      return [];
    }

    // Auto-scroll the feed to load desired number of items
    console.log(`[Scraper] Scrolling feed (target limit: ${limit}, requirePhone: ${hasPhone})`);
    await autoScrollFeed(page, feedSelector, limit, hasPhone);

    // Extract items from feed
    const rawItems = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [];

      const links = feed.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]');
      const results = [];

      links.forEach((link) => {
        const placeUrl = link.getAttribute('href') || '';
        const name = link.getAttribute('aria-label') || link.innerText || '';
        const card = link.closest('div[jsaction]') || link.parentElement;

        let ratingText = '';
        let reviewsText = '';
        let fullText = '';
        let website = '';

        if (card) {
          fullText = card.innerText || '';

          // Look for rating aria-label (e.g. "4.7 stars" or "4.7 stars 1,200 Reviews")
          const ratingElement = card.querySelector('span[role="img"][aria-label*="star"], span[aria-label*="star"]');
          if (ratingElement) {
            ratingText = ratingElement.getAttribute('aria-label') || '';
          }

          // Check if there is an element with reviews aria-label or text
          const reviewElement = card.querySelector('span[aria-label*="review" i], span[aria-label*="ulasan" i]');
          if (reviewElement) {
            reviewsText = reviewElement.getAttribute('aria-label') || reviewElement.innerText || '';
          }

          // Search for parenthesized review badge: (1,234) or (1.2K)
          if (!reviewsText) {
            const allSpans = card.querySelectorAll('span');
            for (const span of allSpans) {
              const txt = (span.innerText || '').trim();
              const match = txt.match(/\(([\d.,kK]+)\)/);
              if (match) {
                reviewsText = match[1];
                break;
              }
            }
          }

          // Check rating parent if it contains review keywords
          if (!reviewsText && ratingElement && ratingElement.parentElement) {
            const parentTxt = ratingElement.parentElement.innerText || '';
            if (/\([\d.,kK]+\)|reviews?|ulasan/i.test(parentTxt)) {
              reviewsText = parentTxt;
            }
          }

          // Extract website link if available in card
          const webEl = card.querySelector('a[data-value*="Website" i], a[aria-label*="website" i]');
          if (webEl) {
            website = webEl.getAttribute('href') || '';
          }
        }

        results.push({
          name,
          placeUrl,
          ratingText,
          reviewsText,
          fullText,
          website,
        });
      });

      return results;
    });

    console.log(`[Scraper] Found ${rawItems.length} raw items from DOM`);

    // Process and normalize extracted items
    const places = [];
    const seenUrls = new Set();

    for (const item of rawItems) {
      if (!item.name || !item.placeUrl) continue;
      if (seenUrls.has(item.placeUrl)) continue;
      seenUrls.add(item.placeUrl);

      const coords = extractCoordinates(item.placeUrl);
      const { category, address, phone, priceLevel } = parseCardFullText(item.fullText, item.name);

      // Filter: if hasPhone is 1, place MUST have a phone number
      if (hasPhone === 1 && !phone) {
        continue;
      }

      let rating = parseRating(item.ratingText);
      let reviewsCount = parseReviewsCount(item.reviewsText) || parseReviewsCount(item.ratingText);

      // Fallback: parse rating and reviews from full text if not found in aria-label
      if (!rating && item.fullText) {
        const ratingMatch = item.fullText.match(/(\d+[.,]\d+)\s*\(/);
        if (ratingMatch) {
          rating = parseRating(ratingMatch[1]);
        }
      }
      if (!reviewsCount && item.fullText) {
        const reviewsMatch = item.fullText.match(/\(([\d.,kK]+)\)/);
        if (reviewsMatch) {
          reviewsCount = parseReviewsCount(reviewsMatch[1]);
        }
      }

      places.push({
        name: cleanText(item.name),
        category: category || 'Business',
        rating: rating || null,
        reviewsCount: reviewsCount || 0,
        address: address || '',
        phone: phone || '',
        website: item.website || '',
        latitude: coords.latitude,
        longitude: coords.longitude,
        placeUrl: item.placeUrl,
        imageUrl: '',
        priceLevel: priceLevel || '',
      });

      if (places.length >= limit) {
        break;
      }
    }

    console.log(`[Scraper] Successfully parsed ${places.length} places (hasPhone filter: ${hasPhone})`);
    return places;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error('[Scraper] Error closing browser:', err);
      }
    }
  }
}

/**
 * Scroll feed element until target count is reached or no more items load
 */
async function autoScrollFeed(page, feedSelector, targetCount, hasPhone = 0) {
  let prevCount = 0;
  let sameCountRepeats = 0;
  const maxRepeats = 6;

  while (sameCountRepeats < maxRepeats) {
    const counts = await page.evaluate((selector) => {
      const feed = document.querySelector(selector);
      if (!feed) return { total: 0, withPhone: 0 };
      const links = feed.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]');
      let withPhoneCount = 0;

      links.forEach((l) => {
        const card = l.closest('div[jsaction]') || l.parentElement;
        const text = card ? card.innerText : '';
        if (/(?:(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5})/.test(text)) {
          withPhoneCount++;
        }
      });

      return { total: links.length, withPhone: withPhoneCount };
    }, feedSelector);

    // If hasPhone is required, check if we gathered enough places with phone
    if (hasPhone === 1 && counts.withPhone >= targetCount) {
      break;
    } else if (hasPhone !== 1 && counts.total >= targetCount) {
      break;
    }

    const currentCount = hasPhone === 1 ? counts.withPhone : counts.total;
    if (currentCount === prevCount) {
      sameCountRepeats++;
    } else {
      sameCountRepeats = 0;
      prevCount = currentCount;
    }

    // Scroll down inside the feed container
    await page.evaluate((selector) => {
      const feed = document.querySelector(selector);
      if (feed) {
        feed.scrollTop = feed.scrollHeight;
      }
    }, feedSelector);

    await delay(1200);

    // Check if end of list banner is reached
    const isEndReached = await page.evaluate(() => {
      const endTexts = ["You've reached the end of the list", "Anda telah mencapai akhir daftar"];
      const bodyText = document.body.innerText || '';
      return endTexts.some((text) => bodyText.includes(text));
    });

    if (isEndReached) {
      break;
    }
  }
}

/**
 * Extract info when redirected directly to a single place page
 */
async function extractSinglePlace(page, url) {
  try {
    const data = await page.evaluate(() => {
      const name = document.querySelector('h1')?.innerText || '';
      const rating = document.querySelector('div[role="main"] span[aria-hidden="true"]')?.innerText || '';
      const category = document.querySelector('button[jsaction*="pane.rating.category"]')?.innerText || '';
      const address = document.querySelector('button[data-item-id*="address"]')?.innerText || '';
      const phone = document.querySelector('button[data-item-id*="phone"]')?.innerText || '';
      const website = document.querySelector('a[data-item-id*="authority"]')?.getAttribute('href') || '';

      return { name, rating, category, address, phone, website };
    });

    const coords = extractCoordinates(url);

    return {
      name: cleanText(data.name),
      category: cleanText(data.category) || 'Business',
      rating: parseRating(data.rating),
      reviewsCount: 0,
      address: cleanText(data.address),
      phone: cleanText(data.phone),
      website: data.website || '',
      latitude: coords.latitude,
      longitude: coords.longitude,
      placeUrl: url,
      imageUrl: '',
      priceLevel: '',
    };
  } catch (e) {
    console.error('[Scraper] Error parsing single place:', e);
    return null;
  }
}

/**
 * Parse card full text lines to deduce category, address, phone, price level
 */
function parseCardFullText(fullText, placeName) {
  if (!fullText) return { category: '', address: '', phone: '', priceLevel: '' };

  // First, extract phone number reliably
  const phone = extractPhoneNumber(fullText);

  const lines = fullText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== placeName);

  let category = '';
  let address = '';
  let priceLevel = '';

  for (const line of lines) {
    // Check for price level (e.g. $, $$, Rp, etc.)
    if (/^[$€£¥]{1,4}$/.test(line)) {
      priceLevel = line;
      continue;
    }

    // Split by middle dot or bullet separator
    if (line.includes('·')) {
      const parts = line.split('·').map((p) => cleanText(p));
      for (const part of parts) {
        if (!category && !part.match(/\d/) && part.length < 35 && !part.toLowerCase().includes('open') && !part.toLowerCase().includes('close')) {
          category = part;
        } else if (part.length > 10 && !part.toLowerCase().includes('open') && !part.toLowerCase().includes('close') && !address) {
          // If this part isn't the phone number, it's likely an address
          if (part !== phone) {
            address = part;
          }
        }
      }
    } else {
      // Standalone line
      if (!category && !line.match(/\d/) && line.length < 35 && !line.toLowerCase().includes('open') && !line.toLowerCase().includes('close')) {
        category = line;
      } else if (line.length > 12 && !address && !line.toLowerCase().includes('open') && !line.toLowerCase().includes('close')) {
        if (line !== phone) {
          address = line;
        }
      }
    }
  }

  return { category, address, phone, priceLevel };
}

module.exports = {
  scrapeGoogleMaps,
};
