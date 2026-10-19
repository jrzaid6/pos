const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// Verify the token and confirm the account is still allowed to use the app.
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    try {
        const result = await pool.query(
            'SELECT is_active, is_deleted, role, token_version FROM users WHERE id = $1',
            [decoded.id]
        );
        const account = result.rows[0];

        if (!account || account.is_deleted) {
            return res.status(401).json({
                code: 'AUTH_ACCOUNT_DELETED',
                error: 'This account no longer exists. Please contact your Business Owner.'
            });
        }

        if (account.is_active !== true) {
            return res.status(401).json({
                code: 'AUTH_ACCOUNT_INACTIVE',
                error: 'Your account is inactive. Please contact your Business Owner to reactivate it.'
            });
        }

        if (Number(decoded.token_version || 0) !== Number(account.token_version || 0)) {
            return res.status(401).json({
                code: 'AUTH_SESSION_REVOKED',
                error: 'Your login session has changed. Please sign in again.'
            });
        }

        // Use the current role from the database so authorization cannot rely on a stale JWT role.
        req.user = { ...decoded, role: account.role };
        return next();
    } catch (error) {
        console.error('Account status check failed:', error);
        return res.status(503).json({
            code: 'AUTH_STATUS_UNAVAILABLE',
            error: 'Unable to verify your account right now. Please try again.'
        });
    }
};

// Check role permissions
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        next();
    };
};

module.exports = { authenticate, authorize };
