const bcrypt = require('bcryptjs');
const pool = require('../config/database');

const createInitialAdmin = async () => {
    const name = String(process.env.INITIAL_ADMIN_NAME || '').trim();
    const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.INITIAL_ADMIN_PASSWORD || '';

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
        throw new Error('Set INITIAL_ADMIN_NAME, a valid INITIAL_ADMIN_EMAIL, and an INITIAL_ADMIN_PASSWORD of 12–128 characters.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(20261012, 2)');
        const existingAdmin = await client.query(
            "SELECT 1 FROM users WHERE role = 'admin' AND is_deleted = false LIMIT 1"
        );
        if (existingAdmin.rows.length) throw new Error('An active admin already exists; this setup command will not replace or reset an account.');

        const passwordHash = await bcrypt.hash(password, 12);
        await client.query(
            `INSERT INTO users (name, email, password_hash, role, is_active)
             VALUES ($1, $2, $3, 'admin', true)`,
            [name, email, passwordHash]
        );
        await client.query('COMMIT');
        console.log(`Initial admin created for ${email}.`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

createInitialAdmin()
    .catch((error) => {
        console.error(error.message || 'Could not create the initial admin.');
        process.exitCode = 1;
    })
    .finally(() => pool.end());
