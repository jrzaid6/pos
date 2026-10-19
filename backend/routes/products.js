const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth');
const { 
    getProducts,
    getProductByBarcode,
    createProduct,
    updateProduct,
    bulkPriceUpdate,
    deleteProduct,
    updateStock,
    getLowStock,
    getCategories,
    createCategory 
} = require('../controllers/productController');

router.get('/', authenticate, getProducts);
router.get('/low-stock', authenticate, authorize('admin', 'manager'), getLowStock);
router.get('/barcode/:barcode', authenticate, getProductByBarcode);
router.get('/categories', authenticate, getCategories);
router.post('/categories', authenticate, authorize('admin', 'manager'), createCategory);
router.post('/', authenticate, authorize('admin', 'manager'), createProduct);
router.put('/bulk-price-update', authenticate, authorize('admin', 'manager'), bulkPriceUpdate);
router.put('/:id', authenticate, authorize('admin', 'manager'), updateProduct);
router.put('/:id/stock', authenticate, authorize('admin', 'manager'), updateStock);
router.delete('/:id', authenticate, authorize('admin'), deleteProduct);

module.exports = router;
