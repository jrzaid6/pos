const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth');
const { getCustomerLedger, recordPayment, getPendingCredits, getTotalPending, getCustomerUnpaidBills } = require('../controllers/creditController');

router.get('/pending', authenticate, authorize('admin', 'manager'), getPendingCredits);
router.get('/total', authenticate, authorize('admin', 'manager'), getTotalPending);
router.get('/customer/:customer_id/unpaid-bills', authenticate, authorize('admin', 'manager'), getCustomerUnpaidBills);
router.get('/customer/:customer_id', authenticate, authorize('admin', 'manager'), getCustomerLedger);
router.post('/payment', authenticate, authorize('admin', 'manager'), recordPayment);

module.exports = router;
