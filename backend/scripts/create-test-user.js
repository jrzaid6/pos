const bcrypt = require('bcryptjs');
const pool = require('../config/database');

const createTestUser = async () => {
    const name = String(process.env.TEST_USER_NAME || 'Test User').trim();
    const email = String(process.env.TEST_USER_EMAIL || '').trim().toLowerCase();
    const password = process.env.TEST_USER_PASSWORD || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
        throw new Error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD (12–128 characters) in the environment.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'cashier', true)`,
        [name, email, passwordHash]
    );
    console.log(`Test cashier created for ${email}.`);
};

createTestUser()
    .catch((error) => {
        console.error(error.code === '23505' ? 'That test email already exists; no account was replaced.' : error.message || 'Could not create test user.');
        process.exitCode = 1;
    })
    .finally(() => pool.end());
