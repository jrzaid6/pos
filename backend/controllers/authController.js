const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { writeAudit } = require('../services/auditLogger');

const validRoles = new Set(['admin', 'manager', 'cashier']);
const isValidUserId = (id) => /^\d+$/.test(String(id)) && Number(id) > 0;
const normalizeUser = ({ name, email, role }) => {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanName || cleanName.length > 100) return { error: 'Name is required and must be 100 characters or less' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 100) return { error: 'Enter a valid email address' };
    if (!validRoles.has(role)) return { error: 'Role must be admin, manager, or cashier' };
    return { name: cleanName, email: cleanEmail, role };
};

const withTransaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const value = await callback(client);
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const ensureAdminNotLockedOut = async (client, current, next) => {
    const removesActiveAdmin = current.role === 'admin' && current.is_active && !current.is_deleted &&
        (next.role !== 'admin' || next.is_active === false || next.is_deleted === true);
    if (!removesActiveAdmin) return;
    const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM users
         WHERE role = 'admin' AND is_active = true AND is_deleted = false`
    );
    if (result.rows[0].count <= 1) {
        const error = new Error('Keep at least one active admin account');
        error.status = 400;
        throw error;
    }
};

// Login
const login = async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({
                code: 'AUTH_MISSING_FIELDS',
                error: 'Email and password required'
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                code: 'AUTH_INVALID_CREDENTIALS',
                error: 'Invalid credentials'
            });
        }

        const user = result.rows[0];

        if (user.is_deleted) {
            return res.status(403).json({
                code: 'AUTH_ACCOUNT_DELETED',
                error: 'Account no longer exists'
            });
        }

        if (user.is_active !== true) {
            return res.status(403).json({
                code: 'AUTH_ACCOUNT_INACTIVE',
                error: 'Your account is inactive. Please contact your Business Owner to reactivate it.'
            });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({
                code: 'AUTH_INVALID_CREDENTIALS',
                error: 'Invalid credentials'
            });
        }

        const sessionResult = await pool.query('SELECT session_timeout_minutes FROM shop_settings WHERE id = 1');
        const timeoutMinutes = Number(sessionResult.rows[0]?.session_timeout_minutes);
        const tokenExpiry = Number.isInteger(timeoutMinutes) && timeoutMinutes >= 1 && timeoutMinutes <= 1440
            ? `${timeoutMinutes}m`
            : (process.env.JWT_EXPIRES_IN || '1d');
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name, role: user.role, token_version: user.token_version || 0 },
            process.env.JWT_SECRET,
            { expiresIn: tokenExpiry }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ code: 'AUTH_SERVER_ERROR', error: 'Server error' });
    }
};

const getProfile = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const getUsers = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, role, is_active, created_at FROM users WHERE is_deleted = false ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const createUser = async (req, res) => {
    try {
        const { name, email, password, role, is_active = true } = req.body || {};
        const normalized = normalizeUser({ name, email, role });
        if (normalized.error) return res.status(400).json({ error: normalized.error });
        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
        }
        if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'Status must be active or inactive' });

        const passwordHash = await bcrypt.hash(password, 10);
        const created = await withTransaction(async (client) => {
            const result = await client.query(
                `INSERT INTO users (name, email, password_hash, role, is_active)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, name, email, role, is_active, created_at`,
                [normalized.name, normalized.email, passwordHash, normalized.role, is_active]
            );
            const user = result.rows[0];
            await writeAudit(client, {
                userId: req.user.id, action: 'user_created', targetType: 'user', targetId: user.id,
                details: { name: user.name, email: user.email, role: user.role, is_active: user.is_active }
            });
            return user;
        });
        res.status(201).json(created);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Server error' });
    }
};

const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidUserId(id)) return res.status(400).json({ error: 'User ID must be a positive integer' });
        const { name, email, role, is_active, password } = req.body || {};
        const normalized = normalizeUser({ name, email, role });
        if (normalized.error) return res.status(400).json({ error: normalized.error });
        if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'Status must be active or inactive' });
        if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
            return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
        }
        const passwordHash = password ? await bcrypt.hash(password, 10) : null;

        const updated = await withTransaction(async (client) => {
            const existingResult = await client.query(
                'SELECT id, name, email, role, is_active, is_deleted FROM users WHERE id = $1 AND is_deleted = false FOR UPDATE', [id]
            );
            const current = existingResult.rows[0];
            if (!current) return null;
            await ensureAdminNotLockedOut(client, current, { ...normalized, is_active });
            const result = await client.query(
                `UPDATE users SET name=$1, email=$2, role=$3, is_active=$4,
                    password_hash=COALESCE($5, password_hash), token_version=token_version+1, updated_at=NOW()
                 WHERE id=$6 RETURNING id, name, email, role, is_active, created_at`,
                [normalized.name, normalized.email, normalized.role, is_active, passwordHash, id]
            );
            const user = result.rows[0];
            await writeAudit(client, {
                userId: req.user.id, action: 'user_updated', targetType: 'user', targetId: user.id,
                details: { before: { name: current.name, email: current.email, role: current.role, is_active: current.is_active },
                    after: { name: user.name, email: user.email, role: user.role, is_active: user.is_active },
                    password_changed: Boolean(passwordHash) }
            });
            return user;
        });
        if (!updated) return res.status(404).json({ error: 'User not found' });
        res.json(updated);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Server error' });
    }
};

const resetUserPassword = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidUserId(id)) return res.status(400).json({ error: 'User ID must be a positive integer' });
        const { password } = req.body || {};

        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const updated = await withTransaction(async (client) => {
            const result = await client.query(
                `UPDATE users SET password_hash=$1, token_version=token_version+1, updated_at=NOW()
                 WHERE id=$2 AND is_deleted=false RETURNING id, name, email`, [passwordHash, id]
            );
            const user = result.rows[0];
            if (!user) return null;
            await writeAudit(client, {
                userId: req.user.id, action: 'user_password_reset', targetType: 'user', targetId: user.id,
                details: { name: user.name, email: user.email }
            });
            return user;
        });
        if (!updated) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Password reset successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const toggleUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidUserId(id)) return res.status(400).json({ error: 'User ID must be a positive integer' });
        const { is_active } = req.body || {};
        if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'Status must be active or inactive' });
        if (Number(id) === Number(req.user.id) && !is_active) return res.status(400).json({ error: 'You cannot deactivate your own account' });
        const updated = await withTransaction(async (client) => {
            const existingResult = await client.query(
                'SELECT id, name, email, role, is_active, is_deleted FROM users WHERE id=$1 AND is_deleted=false FOR UPDATE', [id]
            );
            const current = existingResult.rows[0];
            if (!current) return null;
            await ensureAdminNotLockedOut(client, current, { role: current.role, is_active, is_deleted: false });
            const result = await client.query(
                `UPDATE users SET is_active=$1, token_version=token_version+1, updated_at=NOW()
                 WHERE id=$2 RETURNING id, name, email, role, is_active`, [is_active, id]
            );
            const user = result.rows[0];
            await writeAudit(client, {
                userId: req.user.id, action: is_active ? 'user_activated' : 'user_deactivated',
                targetType: 'user', targetId: user.id, details: { name: user.name, email: user.email, role: user.role }
            });
            return user;
        });
        if (!updated) return res.status(404).json({ error: 'User not found' });
        res.json(updated);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidUserId(id)) return res.status(400).json({ error: 'User ID must be a positive integer' });

        if (Number(id) === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const deleted = await withTransaction(async (client) => {
            const existingUser = await client.query(
                'SELECT id, name, email, role, is_active, is_deleted FROM users WHERE id = $1 AND is_deleted = false FOR UPDATE', [id]
            );
            const current = existingUser.rows[0];
            if (!current) return false;
            await ensureAdminNotLockedOut(client, current, { role: current.role, is_active: false, is_deleted: true });
            await client.query(
                'UPDATE users SET is_deleted = true, is_active = false, token_version=token_version+1, updated_at=NOW() WHERE id = $1', [id]
            );
            await writeAudit(client, {
                userId: req.user.id, action: 'user_deleted', targetType: 'user', targetId: current.id,
                details: { name: current.name, email: current.email, role: current.role }
            });
            return true;
        });
        if (!deleted) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { login, getProfile, getUsers, createUser, updateUser, resetUserPassword, toggleUserStatus, deleteUser };
