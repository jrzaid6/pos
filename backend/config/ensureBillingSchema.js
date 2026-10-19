const pool = require('./database');

const hasColumn = async (client, tableName, columnName) => {
    const result = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [tableName, columnName]
    );

    return result.rows.length > 0;
};

const ensureBillingSchema = async () => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const salesColumns = [
            ['payment_breakdown', `ALTER TABLE sales ADD COLUMN payment_breakdown JSONB DEFAULT '{"cash":0,"upi":0,"credit":0}'::jsonb`],
            ['amount_paid', `ALTER TABLE sales ADD COLUMN amount_paid DECIMAL(10,2) DEFAULT 0`],
            ['balance_due', `ALTER TABLE sales ADD COLUMN balance_due DECIMAL(10,2) DEFAULT 0`],
            ['cash_received', `ALTER TABLE sales ADD COLUMN cash_received DECIMAL(10,2) DEFAULT 0`],
            ['change_return', `ALTER TABLE sales ADD COLUMN change_return DECIMAL(10,2) DEFAULT 0`],
            ['notes', `ALTER TABLE sales ADD COLUMN notes TEXT`]
        ];

        for (const [columnName, query] of salesColumns) {
            if (!(await hasColumn(client, 'sales', columnName))) {
                await client.query(query);
            }
        }

        const productColumns = [
            ['cash_stock', `ALTER TABLE products ADD COLUMN cash_stock NUMERIC(14,3) NOT NULL DEFAULT 0`],
            ['bank_stock', `ALTER TABLE products ADD COLUMN bank_stock NUMERIC(14,3) NOT NULL DEFAULT 0`]
        ];

        for (const [columnName, query] of productColumns) {
            if (!(await hasColumn(client, 'products', columnName))) {
                await client.query(query);
            }
        }

        if (!(await hasColumn(client, 'sale_items', 'stock_source'))) {
            await client.query(`ALTER TABLE sale_items ADD COLUMN stock_source VARCHAR(20) NOT NULL DEFAULT 'bank'`);
        }

        await client.query(`
            ALTER TABLE products
                ALTER COLUMN stock TYPE NUMERIC(14,3) USING stock::numeric,
                ALTER COLUMN cash_stock TYPE NUMERIC(14,3) USING cash_stock::numeric,
                ALTER COLUMN bank_stock TYPE NUMERIC(14,3) USING bank_stock::numeric,
                ALTER COLUMN min_stock TYPE NUMERIC(14,3) USING min_stock::numeric;
            ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::numeric;
            ALTER TABLE inventory_logs
                ALTER COLUMN quantity_change TYPE NUMERIC(14,3) USING quantity_change::numeric,
                ALTER COLUMN previous_stock TYPE NUMERIC(14,3) USING previous_stock::numeric,
                ALTER COLUMN new_stock TYPE NUMERIC(14,3) USING new_stock::numeric;
        `);

        await client.query(`
            UPDATE products
            SET bank_stock = COALESCE(bank_stock, 0),
                cash_stock = COALESCE(cash_stock, 0)
        `);

        await client.query(`
            UPDATE products
            SET bank_stock = CASE
                    WHEN COALESCE(bank_stock, 0) = 0 AND COALESCE(cash_stock, 0) = 0 THEN COALESCE(stock, 0)
                    ELSE COALESCE(bank_stock, 0)
                END,
                cash_stock = COALESCE(cash_stock, 0)
        `);

        await client.query(`
            UPDATE products
            SET stock = COALESCE(bank_stock, 0) + COALESCE(cash_stock, 0)
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS vendors (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150) NOT NULL UNIQUE,
                phone VARCHAR(30),
                address TEXT,
                gst_number VARCHAR(30),
                opening_balance DECIMAL(10,2) DEFAULT 0,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS purchase_entries (
                id SERIAL PRIMARY KEY,
                product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
                vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
                source VARCHAR(20) NOT NULL CHECK (source IN ('cash', 'bank')),
                invoice_no VARCHAR(80),
                purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
                purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                payment_status VARCHAR(20) DEFAULT 'paid' CHECK (payment_status IN ('paid','partial','unpaid')),
                paid_amount DECIMAL(10,2) DEFAULT 0,
                due_amount DECIMAL(10,2) DEFAULT 0,
                note TEXT,
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS bank_cash_transactions (
                id SERIAL PRIMARY KEY,
                sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
                purchase_entry_id INTEGER REFERENCES purchase_entries(id) ON DELETE CASCADE,
                section VARCHAR(20) NOT NULL CHECK (section IN ('cash', 'bank')),
                transaction_type VARCHAR(30) NOT NULL,
                amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                payment_method VARCHAR(20),
                reference TEXT,
                note TEXT,
                meta JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS vendor_payments (
                id SERIAL PRIMARY KEY,
                vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
                amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
                method VARCHAR(20) DEFAULT 'bank' CHECK (method IN ('bank', 'cash', 'upi')),
                reference TEXT,
                note TEXT,
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS purchase_returns (
                id SERIAL PRIMARY KEY,
                vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
                product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
                source VARCHAR(20) NOT NULL CHECK (source IN ('cash', 'bank')),
                quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
                unit_price DECIMAL(10,2) DEFAULT 0,
                amount DECIMAL(10,2) DEFAULT 0,
                note TEXT,
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const purchaseColumns = [
            ['vendor_id', `ALTER TABLE purchase_entries ADD COLUMN vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL`],
            ['invoice_no', `ALTER TABLE purchase_entries ADD COLUMN invoice_no VARCHAR(80)`],
            ['purchase_date', `ALTER TABLE purchase_entries ADD COLUMN purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`],
            ['payment_status', `ALTER TABLE purchase_entries ADD COLUMN payment_status VARCHAR(20) DEFAULT 'paid'`],
            ['paid_amount', `ALTER TABLE purchase_entries ADD COLUMN paid_amount DECIMAL(10,2) DEFAULT 0`],
            ['due_amount', `ALTER TABLE purchase_entries ADD COLUMN due_amount DECIMAL(10,2) DEFAULT 0`]
        ];

        for (const [columnName, query] of purchaseColumns) {
            if (!(await hasColumn(client, 'purchase_entries', columnName))) {
                await client.query(query);
            }
        }

        await client.query(`ALTER TABLE purchase_entries ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::numeric`);
        await client.query(`ALTER TABLE purchase_returns ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::numeric`);

        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_schema = 'public'
                      AND table_name = 'purchase_entries'
                      AND constraint_name = 'purchase_entries_payment_status_check'
                ) THEN
                    ALTER TABLE purchase_entries
                    ADD CONSTRAINT purchase_entries_payment_status_check
                    CHECK (payment_status IN ('paid','partial','unpaid'));
                END IF;
            END $$;
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_purchase_entries_product_date ON purchase_entries(product_id, created_at DESC)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_purchase_entries_vendor_date ON purchase_entries(vendor_id, created_at DESC)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bank_cash_transactions_section_date ON bank_cash_transactions(section, created_at DESC)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor_date ON vendor_payments(vendor_id, created_at DESC)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_purchase_returns_vendor_date ON purchase_returns(vendor_id, created_at DESC)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sale_items_stock_source ON sale_items(stock_source)
        `);

        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_schema = 'public'
                      AND table_name = 'sales'
                      AND constraint_name = 'sales_payment_method_check'
                ) THEN
                    ALTER TABLE sales DROP CONSTRAINT sales_payment_method_check;
                END IF;
            END $$;
        `);

        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_schema = 'public'
                      AND table_name = 'sales'
                      AND constraint_name = 'sales_payment_method_check'
                ) THEN
                    ALTER TABLE sales
                    ADD CONSTRAINT sales_payment_method_check
                    CHECK (payment_method IN ('cash', 'upi', 'udhar', 'split'));
                END IF;
            END $$;
        `);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = ensureBillingSchema;
