const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth');
const { createSale, getSales, getSalesAnalytics, getSale, getTodaySummary } = require('../controllers/saleController');

router.get('/', authenticate, getSales);
router.get('/today', authenticate, authorize('admin', 'manager'), getTodaySummary);
router.get('/analytics', authenticate, authorize('admin', 'manager'), getSalesAnalytics);
router.get('/:id', authenticate, authorize('admin', 'manager'), getSale);
router.post('/', authenticate, createSale);

module.exports = router;
