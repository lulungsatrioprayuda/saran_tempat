/**
 * Input validator for scrape requests
 */
function validateScrapeInput(body) {
  const errors = [];
  let { query, location, limit } = body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    errors.push('Query is required and must be a non-empty string.');
  } else {
    query = query.trim();
  }

  if (location && typeof location === 'string') {
    location = location.trim();
  } else {
    location = '';
  }

  let parsedLimit = parseInt(limit, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20; // default
  } else if (parsedLimit > 100) {
    parsedLimit = 100; // max threshold to prevent abuse/timeouts
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      query,
      location,
      limit: parsedLimit,
    },
  };
}

module.exports = {
  validateScrapeInput,
};
