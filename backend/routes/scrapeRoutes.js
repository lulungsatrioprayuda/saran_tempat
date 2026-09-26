const express = require('express');
const router = express.Router();
const { validateScrapeInput } = require('../utils/validator');
const { scrapeGoogleMaps } = require('../services/scraperService');

/**
 * POST /api/scrape
 * Body: { query, location, limit, hasPhone }
 */
router.post('/', async (req, res, next) => {
  try {
    const validation = validateScrapeInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors,
      });
    }

    const { query, location, limit, hasPhone } = validation.data;

    console.log(
      `[API /api/scrape] Received request: query="${query}", location="${location}", limit=${limit}, hasPhone=${hasPhone}`
    );

    const places = await scrapeGoogleMaps({ query, location, limit, hasPhone });

    return res.status(200).json({
      success: true,
      count: places.length,
      query,
      location: location || null,
      hasPhone,
      data: places,
    });
  } catch (error) {
    console.error('[API /api/scrape] Error during scraping:', error);
    next(error);
  }
});

module.exports = router;
