const express = require('express');
const router = express.Router();
const vendor = require('../controllers/vendorController');
const { authenticate, authorize } = require('../middlewares/auth');
const { getDashboard, getExportData } = require('../controllers/bankCashController');

router.get('/dashboard', authenticate, authorize('admin', 'manager'), getDashboard);
router.get('/purchases', authenticate, authorize('admin', 'manager'), vendor.getPurchases);
router.get('/vendors', authenticate, authorize('admin', 'manager'), vendor.getVendors);
router.get('/vendor-summary', authenticate, authorize('admin', 'manager'), vendor.getSummary);
router.get('/vendors/:id/ledger', authenticate, authorize('admin', 'manager'), vendor.getLedger);
router.patch('/vendors/:id/status', authenticate, authorize('admin', 'manager'), vendor.setActive);
router.get('/vendor-payments', authenticate, authorize('admin', 'manager'), vendor.getPayments);
router.get('/purchase-returns', authenticate, authorize('admin', 'manager'), vendor.getReturns);
router.get('/export', authenticate, authorize('admin', 'manager'), getExportData);
router.post('/vendors', authenticate, authorize('admin', 'manager'), vendor.saveVendor);
router.put('/vendors/:id', authenticate, authorize('admin', 'manager'), vendor.saveVendor);
router.delete('/vendors/:id', authenticate, authorize('admin', 'manager'), vendor.setActive);
router.post('/vendor-payments', authenticate, authorize('admin', 'manager'), vendor.createPayment);
router.post('/vendor-payments/:id/allocate', authenticate, authorize('admin', 'manager'), vendor.allocatePayment);
router.post('/purchase-returns', authenticate, authorize('admin', 'manager'), vendor.createReturn);
router.post('/purchases', authenticate, authorize('admin', 'manager'), vendor.createPurchase);
router.delete('/purchases/:id', authenticate, authorize('admin', 'manager'), vendor.cancelPurchase);

module.exports = router;
