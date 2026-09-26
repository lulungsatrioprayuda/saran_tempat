const express = require('express');
const router = express.Router();

/**
 * POST /api/export
 * Body: { query, location, data }
 */
router.post('/', async (req, res, next) => {
  try {
    const { query = 'places', data = [] } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data provided to export',
      });
    }

    // Placeholder response for Phase 1
    return res.status(200).json({
      success: true,
      message: 'Export route ready (Phase 1)',
      receivedItems: data.length,
      query,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
