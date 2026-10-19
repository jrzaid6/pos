const bcrypt = require('bcryptjs');
const pool = require('./config/database');

const resetPassword = async () => {
    const email = String(process.env.RESET_USER_EMAIL || '').trim().toLowerCase();
    const password = process.env.RESET_USER_PASSWORD || '';
    if (!email || password.length < 12 || password.length > 128) {
        throw new Error('Set RESET_USER_EMAIL and RESET_USER_PASSWORD (12–128 characters) in the environment.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
        `UPDATE users SET password_hash=$1, token_version=token_version+1, updated_at=NOW()
         WHERE LOWER(email)=LOWER($2) AND is_deleted=false RETURNING id`,
        [passwordHash, email]
    );
    if (!result.rowCount) throw new Error('No active user matched RESET_USER_EMAIL.');
    console.log('Password updated. Existing login tokens have been revoked.');
};

resetPassword()
    .catch((error) => {
        console.error(error.message || 'Could not update the password.');
        process.exitCode = 1;
    })
    .finally(() => pool.end());
