require('dotenv').config();
const path = require('path');
const { runner } = require('node-pg-migrate');
const { Client } = require('pg');

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
if (!DB_HOST || !DB_USER || !DB_NAME) {
    console.error('Set DB_HOST, DB_USER, and DB_NAME in backend/.env before running migrations.');
    process.exit(1);
}

const databaseConfig = {
    host: DB_HOST,
    port: Number(DB_PORT || 5432),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
};

const preflightExistingDatabase = async () => {
    const client = new Client(databaseConfig);
    await client.connect();
    try {
        const migrationTable = await client.query("SELECT to_regclass('public.pgmigrations') AS name");
        const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
        const existingNames = new Set(tables.rows.map((row) => row.table_name));
        const hasBusinessTables = ['users', 'products', 'sales'].some((name) => existingNames.has(name));

        if (!migrationTable.rows[0].name && hasBusinessTables) {
            throw new Error('Existing POS tables have no migration history. No changes were made; inspect and back up this database before adopting migrations.');
        }

        if (migrationTable.rows[0].name) {
            const requiredColumns = [
                ['users', 'email'], ['users', 'password_hash'], ['products', 'selling_price'],
                ['products', 'cash_stock'], ['products', 'bank_stock'], ['customers', 'is_deleted'],
                ['sales', 'bill_number'], ['sales', 'payment_status'], ['sales', 'is_deleted'],
                ['sale_items', 'total'], ['sale_items', 'stock_source'],
                ['credit_payments', 'payment_method'], ['shop_settings', 'shop_name']
            ];
            const columns = await client.query(
                "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'"
            );
            const available = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
            const missing = requiredColumns.filter(([table, column]) => !available.has(`${table}.${column}`));
            if (missing.length) {
                throw new Error(`Database schema needs a reviewed upgrade before migrations can run (${missing.map(([table, column]) => `${table}.${column}`).join(', ')} missing). No changes were made.`);
            }
        }
    } finally {
        await client.end();
    }
};

preflightExistingDatabase().then(() => runner({
    databaseUrl: databaseConfig,
    dir: path.resolve(__dirname, '../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    singleTransaction: true
})).then(() => {
    console.log('Database migrations completed.');
}).catch((error) => {
    console.error(`Database migrations failed: ${error.message || error.code || 'unknown error'}`);
    process.exitCode = 1;
});
