/**
 * Data parser and cleaner utility for Google Maps scraping
 */

/**
 * Extract latitude and longitude from Google Maps URL
 * Supports formats:
 * - /@(-?\d+\.\d+),(-?\d+\.\d+)
 * - !3d(-?\d+\.\d+)!4d(-?\d+\.\d+)
 */
function extractCoordinates(url) {
  if (!url || typeof url !== 'string') {
    return { latitude: null, longitude: null };
  }

  // Format 1: @lat,lng
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return {
      latitude: parseFloat(atMatch[1]),
      longitude: parseFloat(atMatch[2]),
    };
  }

  // Format 2: !3dlat!4dlng
  const d3Match = url.match(/!3d(-?\d+\.\d+)/);
  const d4Match = url.match(/!4d(-?\d+\.\d+)/);
  if (d3Match && d4Match) {
    return {
      latitude: parseFloat(d3Match[1]),
      longitude: parseFloat(d4Match[1]),
    };
  }

  return { latitude: null, longitude: null };
}

/**
 * Parse rating number from text/aria-label
 * e.g., "4,7 bintang", "4.7 stars", "4.7"
 */
function parseRating(ratingStr) {
  if (!ratingStr) return null;
  if (typeof ratingStr === 'number') return ratingStr;

  const match = String(ratingStr).match(/(\d+[.,]\d+|\d+)/);
  if (match) {
    const normalized = match[1].replace(',', '.');
    const val = parseFloat(normalized);
    return isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Parse review count from text/aria-label
 * Handles formats like:
 * - "1,240 Reviews" / "1.240 ulasan"
 * - "(1,240)"
 * - "1.2K reviews" / "1,2rb ulasan"
 * - Combined: "4.7 stars 1,240 Reviews"
 */
function parseReviewsCount(reviewsStr) {
  if (!reviewsStr) return 0;
  if (typeof reviewsStr === 'number') return reviewsStr;

  const clean = String(reviewsStr).trim();

  // If it's a combined string like "4.7 stars 1,240 Reviews"
  const combinedMatch = clean.match(/(?:stars?|bintang)\s+([\d.,]+)\s*(?:reviews?|ulasan)?/i);
  if (combinedMatch) {
    const rawDigits = combinedMatch[1].replace(/[.,]/g, '');
    const val = parseInt(rawDigits, 10);
    return isNaN(val) ? 0 : val;
  }

  // Check for 'k' or 'rb' (e.g. 1.2k, 2,5rb)
  const kMatch = clean.match(/(\d+[.,]?\d*)\s*(?:k|rb)/i);
  if (kMatch) {
    const num = parseFloat(kMatch[1].replace(',', '.'));
    return Math.round(num * 1000);
  }

  // Check for explicit "reviews" or "ulasan"
  const wordMatch = clean.match(/([\d.,]+)\s*(?:reviews?|ulasan)/i);
  if (wordMatch) {
    const rawDigits = wordMatch[1].replace(/[.,]/g, '');
    const val = parseInt(rawDigits, 10);
    return isNaN(val) ? 0 : val;
  }

  // Check parenthesized number: e.g. "(1,240)"
  const parenMatch = clean.match(/\(([\d.,]+)\)/);
  if (parenMatch) {
    const rawDigits = parenMatch[1].replace(/[.,]/g, '');
    const val = parseInt(rawDigits, 10);
    return isNaN(val) ? 0 : val;
  }

  // Check plain numbers e.g. "6,188" or "12.410" or "450"
  // Ignore single digit or decimal ratings like "4.5" or "4,5"
  if (/^[\d.,]+$/.test(clean)) {
    const asFloat = parseFloat(clean.replace(',', '.'));
    if (!clean.includes(',') && !clean.includes('.') && asFloat <= 5) {
      // Could be a very small integer or ambiguous, but let's check
    } else if (asFloat <= 5.0 && (clean.includes('.') || clean.includes(',')) && !clean.includes('00')) {
      // This is a rating (e.g., 4.5, 4.8), not a review count
      return 0;
    }
    const rawDigits = clean.replace(/[.,]/g, '');
    const val = parseInt(rawDigits, 10);
    return isNaN(val) ? 0 : val;
  }

  // If the string only mentions "stars" and has no other numbers, return 0 (not reviews)
  if (clean.toLowerCase().includes('star') && !clean.toLowerCase().includes('review')) {
    return 0;
  }

  return 0;
}

/**
 * Clean text strings: strip extra whitespace, newlines, zero-width characters
 */
function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  extractCoordinates,
  parseRating,
  parseReviewsCount,
  cleanText,
};
