const express = require('express');
const router = express.Router();

/**
 * POST /api/scrape
 * Body: { query, location, limit }
 */
router.post('/', async (req, res, next) => {
  try {
    const { query, location, limit = 20 } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required',
      });
    }

    // Placeholder response for Phase 1
    return res.status(200).json({
      success: true,
      message: 'Scrape route ready (Phase 1)',
      query,
      location: location || 'Not specified',
      limit: Number(limit),
      count: 0,
      data: [],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
