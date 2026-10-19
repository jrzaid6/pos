const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth');
const { 
    getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
    getCustomerHistory, getCustomersWithBalance 
} = require('../controllers/customerController');

router.get('/', authenticate, getCustomers);
router.get('/with-balance', authenticate, authorize('admin', 'manager'), getCustomersWithBalance);
router.get('/:id', authenticate, authorize('admin', 'manager'), getCustomer);
router.get('/:id/history', authenticate, authorize('admin', 'manager'), getCustomerHistory);
router.post('/', authenticate, createCustomer);
router.put('/:id', authenticate, authorize('admin', 'manager'), updateCustomer);
router.delete('/:id', authenticate, authorize('admin'), deleteCustomer);

module.exports = router;
