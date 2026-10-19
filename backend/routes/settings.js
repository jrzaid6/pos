const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth');
const { getSettings, updateSettings, updateTheme, getReports, getInventoryReport, getAuditLogs, getBackupData } = require('../controllers/settingsController');

router.get('/', authenticate, getSettings);
router.put('/', authenticate, authorize('admin'), updateSettings);
router.put('/theme', authenticate, authorize('admin'), updateTheme);
router.get('/reports', authenticate, authorize('admin', 'manager'), getReports);
router.get('/inventory-report', authenticate, authorize('admin', 'manager'), getInventoryReport);
router.get('/audit-logs', authenticate, authorize('admin'), getAuditLogs);
router.get('/backup', authenticate, authorize('admin'), getBackupData);

module.exports = router;
