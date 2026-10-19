const pool = require('../config/database');

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));
const roundQuantity = (value) => Number(Number(value).toFixed(3));

const getRange = (period, month, year, from, to) => {
    const now = new Date();
    if (period === 'monthly') {
        const targetMonth = Number(month || now.getMonth() + 1) - 1;
        const targetYear = Number(year || now.getFullYear());
        return { from: new Date(targetYear, targetMonth, 1), to: new Date(targetYear, targetMonth + 1, 0, 23, 59, 59) };
    }
    if (period === 'yearly') {
        const targetYear = Number(year || now.getFullYear());
        return { from: new Date(targetYear, 0, 1), to: new Date(targetYear, 11, 31, 23, 59, 59) };
    }
    if (from && to) {
        return { from: new Date(from), to: new Date(`${to}T23:59:59`) };
    }
    return null;
};

const buildDateFilter = (range, alias = 'created_at', startIndex = 1) => {
    if (!range) return { clause: '', params: [] };
    return {
        clause: `WHERE ${alias} BETWEEN $${startIndex} AND $${startIndex + 1}`,
        params: [range.from, range.to]
    };
};

const createPurchaseEntry = async (req, res) => {
    const client = await pool.connect();
    try {
        const { product_id, vendor_id, source, invoice_no, purchase_date, quantity, purchase_price, payment_status = 'paid', paid_amount = 0, note } = req.body;
        if (!product_id || !vendor_id || !['cash', 'bank'].includes(source) || Number(quantity) <= 0) {
            return res.status(400).json({ error: 'Product, vendor, source and quantity are required' });
        }

        if (!['paid', 'partial', 'unpaid'].includes(payment_status)) {
            return res.status(400).json({ error: 'Invalid payment status' });
        }

        await client.query('BEGIN');
        const productResult = await client.query('SELECT * FROM products WHERE id = $1 AND is_active = true FOR UPDATE', [product_id]);
        if (!productResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found' });
        }

        const vendorResult = await client.query('SELECT id, name FROM vendors WHERE id = $1 AND is_active = true', [vendor_id]);
        if (!vendorResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Vendor not found' });
        }

        const product = productResult.rows[0];
        const qty = roundQuantity(quantity);
        if (!Number.isFinite(qty) || qty <= 0 || Math.abs(Number(quantity) - qty) > 0.0000001) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Quantity must be positive and use no more than 3 decimal places' });
        }
        const nextBank = source === 'bank' ? Number(product.bank_stock || 0) + qty : Number(product.bank_stock || 0);
        const nextCash = source === 'cash' ? Number(product.cash_stock || 0) + qty : Number(product.cash_stock || 0);
        const nextTotal = nextBank + nextCash;
        const entryPrice = roundMoney(purchase_price || product.purchase_price || 0);
        const grossAmount = roundMoney(entryPrice * qty);
        const paid = roundMoney(paid_amount || 0);
        const dueAmount = roundMoney(Math.max(grossAmount - paid, 0));

        const entryResult = await client.query(
            `INSERT INTO purchase_entries (product_id, vendor_id, source, invoice_no, purchase_date, quantity, purchase_price, payment_status, paid_amount, due_amount, note, user_id)
             VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, NOW()), $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [product_id, vendor_id, source, invoice_no || null, purchase_date || null, qty, entryPrice, payment_status, paid, dueAmount, note || null, req.user.id]
        );

        await client.query(
            'UPDATE products SET bank_stock = $1, cash_stock = $2, stock = $3, purchase_price = $4, updated_at = NOW() WHERE id = $5',
            [nextBank, nextCash, nextTotal, entryPrice, product_id]
        );

        await client.query(
            `INSERT INTO inventory_logs (product_id, change_type, quantity_change, previous_stock, new_stock, notes, user_id)
             VALUES ($1, 'purchase', $2, $3, $4, $5, $6)`,
            [product_id, qty, Number(product.stock || 0), nextTotal, `${source} purchase entry${note ? ` - ${note}` : ''}`, req.user.id]
        );

        await client.query(
            `INSERT INTO bank_cash_transactions (purchase_entry_id, section, transaction_type, amount, payment_method, reference, note, meta)
             VALUES ($1, $2, 'purchase', $3, $4, $5, $6, $7::jsonb)`,
            [entryResult.rows[0].id, source, grossAmount, source, `PUR-${entryResult.rows[0].id}`, note || null, JSON.stringify({ product_id, quantity: qty, vendor_id, invoice_no: invoice_no || null, payment_status, paid_amount: paid, due_amount: dueAmount })]
        );

        await client.query('COMMIT');
        res.status(201).json(entryResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Create purchase entry error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const getPurchaseEntries = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pe.*, p.name as product_name, p.unit, u.name as user_name, v.name as vendor_name, v.phone as vendor_phone
            FROM purchase_entries pe
            JOIN products p ON pe.product_id = p.id
            LEFT JOIN users u ON pe.user_id = u.id
            LEFT JOIN vendors v ON pe.vendor_id = v.id
            ORDER BY COALESCE(pe.purchase_date, pe.created_at) DESC
            LIMIT 500
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Get purchase entries error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const createVendorPayment = async (req, res) => {
    try {
        const { vendor_id, amount, method = 'bank', reference, note } = req.body;
        if (!vendor_id || Number(amount) <= 0) {
            return res.status(400).json({ error: 'Vendor and valid amount are required' });
        }

        const vendorCheck = await pool.query('SELECT id FROM vendors WHERE id = $1 AND is_active = true', [vendor_id]);
        if (!vendorCheck.rows.length) return res.status(404).json({ error: 'Vendor not found' });

        const result = await pool.query(
            `INSERT INTO vendor_payments (vendor_id, amount, method, reference, note, user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [vendor_id, roundMoney(amount), method, reference || null, note || null, req.user.id]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Create vendor payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getVendorPayments = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT vp.*, v.name as vendor_name, u.name as user_name
            FROM vendor_payments vp
            JOIN vendors v ON v.id = vp.vendor_id
            LEFT JOIN users u ON u.id = vp.user_id
            ORDER BY vp.created_at DESC
            LIMIT 500
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Get vendor payments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const createPurchaseReturn = async (req, res) => {
    const client = await pool.connect();
    try {
        const { vendor_id, product_id, source = 'bank', quantity, unit_price = 0, note } = req.body;
        if (!vendor_id || !product_id || Number(quantity) <= 0 || !['bank', 'cash'].includes(source)) {
            return res.status(400).json({ error: 'Vendor, product, source and quantity are required' });
        }

        await client.query('BEGIN');

        const productResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [product_id]);
        if (!productResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = productResult.rows[0];
        const qty = roundQuantity(quantity);
        if (!Number.isFinite(qty) || qty <= 0 || Math.abs(Number(quantity) - qty) > 0.0000001) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Quantity must be positive and use no more than 3 decimal places' });
        }
        const currentSourceStock = Number(source === 'bank' ? product.bank_stock : product.cash_stock);
        if (qty > currentSourceStock) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Not enough ${source} stock for return` });
        }

        const nextBank = source === 'bank' ? Number(product.bank_stock || 0) - qty : Number(product.bank_stock || 0);
        const nextCash = source === 'cash' ? Number(product.cash_stock || 0) - qty : Number(product.cash_stock || 0);
        const nextTotal = nextBank + nextCash;
        const amount = roundMoney(Number(unit_price || product.purchase_price || 0) * qty);

        const returnResult = await client.query(
            `INSERT INTO purchase_returns (vendor_id, product_id, source, quantity, unit_price, amount, note, user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [vendor_id, product_id, source, qty, roundMoney(unit_price || product.purchase_price || 0), amount, note || null, req.user.id]
        );

        await client.query('UPDATE products SET bank_stock=$1, cash_stock=$2, stock=$3, updated_at=NOW() WHERE id=$4', [nextBank, nextCash, nextTotal, product_id]);

        await client.query(
            `INSERT INTO inventory_logs (product_id, change_type, quantity_change, previous_stock, new_stock, notes, user_id)
             VALUES ($1, 'return', $2, $3, $4, $5, $6)`,
            [product_id, -qty, Number(product.stock || 0), nextTotal, `purchase return (${source})${note ? ` - ${note}` : ''}`, req.user.id]
        );

        await client.query(
            `INSERT INTO bank_cash_transactions (section, transaction_type, amount, payment_method, reference, note, meta)
             VALUES ($1, 'purchase_return', $2, $3, $4, $5, $6::jsonb)`,
            [source, amount, source, `RET-${returnResult.rows[0].id}`, note || null, JSON.stringify({ vendor_id, product_id, quantity: qty })]
        );

        await client.query('COMMIT');
        res.status(201).json(returnResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Create purchase return error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const getPurchaseReturns = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pr.*, v.name as vendor_name, p.name as product_name, p.unit, u.name as user_name
            FROM purchase_returns pr
            LEFT JOIN vendors v ON v.id = pr.vendor_id
            JOIN products p ON p.id = pr.product_id
            LEFT JOIN users u ON u.id = pr.user_id
            ORDER BY pr.created_at DESC
            LIMIT 500
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Get purchase returns error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getDashboard = async (req, res) => {
    try {
        const { period = 'monthly', month, year, from, to } = req.query;
        const range = getRange(period, month, year, from, to);
        const saleFilter = buildDateFilter(range, 's.created_at');
        const txnFilter = buildDateFilter(range, 't.created_at');
        txnFilter.clause += (txnFilter.clause ? ' AND ' : 'WHERE ') + "COALESCE(t.meta->>'voided','false') <> 'true'";
        const purchaseFilter = buildDateFilter(range, 'pe.purchase_date');
        purchaseFilter.clause += (purchaseFilter.clause ? ' AND ' : 'WHERE ') + 'pe.cancelled_at IS NULL';

        const summaryResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN si.stock_source = 'bank' THEN si.total ELSE 0 END), 0) as bank_sales,
                COALESCE(SUM(CASE WHEN si.stock_source = 'cash' THEN si.total ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN si.stock_source = 'bank' THEN (si.total - (p.purchase_price * si.quantity)) ELSE 0 END), 0) as bank_profit,
                COALESCE(SUM(CASE WHEN si.stock_source = 'cash' THEN (si.total - (p.purchase_price * si.quantity)) ELSE 0 END), 0) as cash_profit
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            JOIN products p ON p.id = si.product_id
            ${saleFilter.clause}
        `, saleFilter.params);

        const booksResult = await pool.query(`
            SELECT t.*
            FROM bank_cash_transactions t
            ${txnFilter.clause}
            ORDER BY t.created_at DESC
            LIMIT 500
        `, txnFilter.params);

        const purchasesResult = await pool.query(`
            SELECT pe.*, p.name as product_name, p.unit
            FROM purchase_entries pe
            JOIN products p ON p.id = pe.product_id
            ${purchaseFilter.clause}
            ORDER BY pe.created_at DESC
            LIMIT 300
        `, purchaseFilter.params);

        const monthlyResult = await pool.query(`
            SELECT TO_CHAR(s.created_at, 'YYYY-MM') as label,
                   COALESCE(SUM(CASE WHEN si.stock_source = 'bank' THEN si.total ELSE 0 END), 0) as bank_sales,
                   COALESCE(SUM(CASE WHEN si.stock_source = 'cash' THEN si.total ELSE 0 END), 0) as cash_sales,
                   COALESCE(SUM(si.total), 0) as total_sales
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            GROUP BY TO_CHAR(s.created_at, 'YYYY-MM')
            ORDER BY label DESC
            LIMIT 24
        `);

        const yearlyResult = await pool.query(`
            SELECT TO_CHAR(s.created_at, 'YYYY') as label,
                   COALESCE(SUM(CASE WHEN si.stock_source = 'bank' THEN si.total ELSE 0 END), 0) as bank_sales,
                   COALESCE(SUM(CASE WHEN si.stock_source = 'cash' THEN si.total ELSE 0 END), 0) as cash_sales,
                   COALESCE(SUM(si.total), 0) as total_sales
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            GROUP BY TO_CHAR(s.created_at, 'YYYY')
            ORDER BY label DESC
            LIMIT 10
        `);

        const inventoryResult = await pool.query(`
            SELECT id, name, unit, purchase_price, selling_price, stock, bank_stock, cash_stock
            FROM products
            WHERE is_active = true
            ORDER BY name
        `);

        const summary = summaryResult.rows[0] || {};
        res.json({
            period,
            range,
            summary: {
                bank_sales: roundMoney(summary.bank_sales),
                cash_sales: roundMoney(summary.cash_sales),
                bank_profit: roundMoney(summary.bank_profit),
                cash_profit: roundMoney(summary.cash_profit),
                total_sales: roundMoney(Number(summary.bank_sales || 0) + Number(summary.cash_sales || 0)),
                total_profit: roundMoney(Number(summary.bank_profit || 0) + Number(summary.cash_profit || 0))
            },
            purchaseEntries: purchasesResult.rows,
            cashBook: booksResult.rows.filter((row) => row.section === 'cash'),
            bankBook: booksResult.rows.filter((row) => row.section === 'bank'),
            monthly: monthlyResult.rows,
            yearly: yearlyResult.rows,
            inventory: inventoryResult.rows,
            profitLoss: {
                bank: roundMoney(summary.bank_profit),
                cash: roundMoney(summary.cash_profit),
                total: roundMoney(Number(summary.bank_profit || 0) + Number(summary.cash_profit || 0))
            }
        });
    } catch (error) {
        console.error('Bank cash dashboard error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getVendors = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, phone, address, gst_number, opening_balance, is_active, created_at
            FROM vendors
            ORDER BY name ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Get vendors error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const createVendor = async (req, res) => {
    try {
        const { name, phone, address, gst_number, opening_balance = 0 } = req.body;
        if (!name) return res.status(400).json({ error: 'Vendor name is required' });

        const result = await pool.query(
            `INSERT INTO vendors (name, phone, address, gst_number, opening_balance)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [name.trim(), phone || null, address || null, gst_number || null, roundMoney(opening_balance)]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Vendor already exists' });
        }
        console.error('Create vendor error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, address, gst_number, opening_balance, is_active } = req.body;
        if (!name) return res.status(400).json({ error: 'Vendor name is required' });

        const check = await pool.query('SELECT id FROM vendors WHERE id = $1', [id]);
        if (!check.rows.length) return res.status(404).json({ error: 'Vendor not found' });

        const result = await pool.query(
            `UPDATE vendors SET name=$1, phone=$2, address=$3, gst_number=$4, opening_balance=$5, is_active=$6
             WHERE id=$7 RETURNING *`,
            [name.trim(), phone || null, address || null, gst_number || null, roundMoney(opening_balance || 0), is_active ?? true, id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update vendor error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('UPDATE vendors SET is_active = false WHERE id = $1 RETURNING *', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Vendor not found' });
        res.json({ message: 'Vendor deactivated', vendor: result.rows[0] });
    } catch (error) {
        console.error('Delete vendor error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const deletePurchaseEntry = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const entry = await client.query('SELECT * FROM purchase_entries WHERE id = $1', [id]);
        if (!entry.rows.length) return res.status(404).json({ error: 'Purchase entry not found' });

        const e = entry.rows[0];
        const product = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [e.product_id]);
        if (product.rows.length) {
            const p = product.rows[0];
            const qty = Number(e.quantity || 0);
            const nextBank = e.source === 'bank' ? Math.max(0, Number(p.bank_stock || 0) - qty) : Number(p.bank_stock || 0);
            const nextCash = e.source === 'cash' ? Math.max(0, Number(p.cash_stock || 0) - qty) : Number(p.cash_stock || 0);
            await client.query('UPDATE products SET bank_stock=$1, cash_stock=$2, stock=$3, updated_at=NOW() WHERE id=$4',
                [nextBank, nextCash, nextBank + nextCash, e.product_id]);
            await client.query(
                `INSERT INTO inventory_logs (product_id, change_type, quantity_change, previous_stock, new_stock, notes, user_id)
                 VALUES ($1, 'purchase_delete', $2, $3, $4, $5, $6)`,
                [e.product_id, -qty, Number(p.stock || 0), nextBank + nextCash, 'Purchase entry deleted', req.user.id]
            );
        }

        await client.query('DELETE FROM bank_cash_transactions WHERE purchase_entry_id = $1', [id]);
        await client.query('DELETE FROM purchase_entries WHERE id = $1', [id]);
        await client.query('COMMIT');
        res.json({ message: 'Purchase entry deleted' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Delete purchase entry error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const getExportData = async (req, res) => {
    try {
        const { section = 'bank' } = req.query;
        if (!['bank', 'cash'].includes(section)) {
            return res.status(400).json({ error: 'Invalid section' });
        }

        const salesResult = await pool.query(`
            SELECT s.bill_number, s.created_at, s.payment_method, si.stock_source, p.name as product_name,
                   si.quantity, si.price, si.total
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            JOIN products p ON p.id = si.product_id
            WHERE si.stock_source = $1
            ORDER BY s.created_at DESC
            LIMIT 1000
        `, [section]);

        const bookResult = await pool.query(`
            SELECT section, transaction_type, amount, payment_method, reference, note, created_at
            FROM bank_cash_transactions
            WHERE section = $1 AND COALESCE(meta->>'voided','false') <> 'true'
            ORDER BY created_at DESC
            LIMIT 1000
        `, [section]);

        res.json({ section, sales: salesResult.rows, book: bookResult.rows });
    } catch (error) {
        console.error('Export data error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    createPurchaseEntry,
    getPurchaseEntries,
    deletePurchaseEntry,
    createVendorPayment,
    getVendorPayments,
    createPurchaseReturn,
    getPurchaseReturns,
    getVendors,
    createVendor,
    updateVendor,
    deleteVendor,
    getDashboard,
    getExportData
};
