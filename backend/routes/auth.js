const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth');
const { login, getProfile, getUsers, createUser, updateUser, resetUserPassword, toggleUserStatus, deleteUser } = require('../controllers/authController');

router.post('/login', login);
router.get('/profile', authenticate, getProfile);
router.get('/users', authenticate, authorize('admin'), getUsers);
router.post('/users', authenticate, authorize('admin'), createUser);
router.put('/users/:id', authenticate, authorize('admin'), updateUser);
router.put('/users/:id/password', authenticate, authorize('admin'), resetUserPassword);
router.put('/users/:id/status', authenticate, authorize('admin'), toggleUserStatus);
router.delete('/users/:id', authenticate, authorize('admin'), deleteUser);

module.exports = router;
