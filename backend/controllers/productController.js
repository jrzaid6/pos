const pool = require('../config/database');

const STANDARD_CATEGORIES = ['Dal', 'Oil', 'Atta', 'Sugar', 'Spices', 'General', 'Rice'];
const STANDARD_UNITS = ['Kg', 'Ltr', 'Pcs', 'Tin (15kg)', 'Bori (50kg)'];

const ensureStandardCategories = async () => {
    for (const name of STANDARD_CATEGORIES) {
        const existing = await pool.query('SELECT id FROM categories WHERE name ILIKE $1 LIMIT 1', [name]);
        if (existing.rows.length === 0) {
            await pool.query('INSERT INTO categories (name) VALUES ($1)', [name]);
        }
    }
};

const getNormalizedUnit = (unit) => {
    if (!unit) return 'Kg';
    const matchedUnit = STANDARD_UNITS.find((item) => item.toLowerCase() === String(unit).trim().toLowerCase());
    return matchedUnit || null;
};

const getCategoryIdFromInput = async (categoryId, categoryName) => {
    await ensureStandardCategories();

    if (categoryId) {
        const categoryResult = await pool.query('SELECT id FROM categories WHERE id = $1', [categoryId]);
        if (categoryResult.rows.length === 0) return null;
        return categoryResult.rows[0].id;
    }

    if (categoryName) {
        const categoryResult = await pool.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1) LIMIT 1', [categoryName]);
        if (categoryResult.rows.length === 0) return null;
        return categoryResult.rows[0].id;
    }

    const fallback = await pool.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1) LIMIT 1', ['General']);
    return fallback.rows[0]?.id || null;
};

const normalizeStocks = ({ stock, bank_stock, cash_stock }) => {
    const parsedBank = Number(bank_stock);
    const parsedCash = Number(cash_stock);
    const parsedStock = Number(stock);
    const normalizeQuantity = (value) => Number(Math.max(0, value).toFixed(3));

    if (Number.isFinite(parsedBank) || Number.isFinite(parsedCash)) {
        const bank = Number.isFinite(parsedBank) ? normalizeQuantity(parsedBank) : 0;
        const cash = Number.isFinite(parsedCash) ? normalizeQuantity(parsedCash) : 0;
        return { bank_stock: bank, cash_stock: cash, stock: bank + cash };
    }

    const total = Number.isFinite(parsedStock) ? normalizeQuantity(parsedStock) : 0;
    return { bank_stock: total, cash_stock: 0, stock: total };
};

const getProducts = async (req, res) => {
    try {
        await ensureStandardCategories();
        const result = await pool.query(`
            SELECT p.*, c.name as category_name,
                   COALESCE(p.bank_stock, 0) as bank_stock,
                   COALESCE(p.cash_stock, 0) as cash_stock,
                   (COALESCE(p.bank_stock, 0) + COALESCE(p.cash_stock, 0)) as total_stock
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.is_active = true AND p.is_deleted = false
            ORDER BY c.name NULLS LAST, p.name
        `);
        res.json(req.user.role === 'cashier'
            ? result.rows.map(({ purchase_price, ...product }) => product)
            : result.rows);
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getProductByBarcode = async (req, res) => {
    try {
        const { barcode } = req.params;
        const result = await pool.query(
            `SELECT p.*, c.name as category_name,
                    COALESCE(p.bank_stock, 0) as bank_stock,
                    COALESCE(p.cash_stock, 0) as cash_stock,
                    (COALESCE(p.bank_stock, 0) + COALESCE(p.cash_stock, 0)) as total_stock
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.barcode = $1 AND p.is_active = true`,
            [barcode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = result.rows[0];
        if (req.user.role === 'cashier') delete product.purchase_price;
        res.json(product);
    } catch (error) {
        console.error('Barcode lookup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const createProduct = async (req, res) => {
    try {
        const { name, category_id, category, brand, barcode, purchase_price, selling_price, stock, min_stock, unit, bank_stock, cash_stock } = req.body;

        if (!name || purchase_price === undefined || selling_price === undefined) {
            return res.status(400).json({ error: 'Name, purchase price and selling price required' });
        }

        const normalizedUnit = getNormalizedUnit(unit);
        if (!normalizedUnit) {
            return res.status(400).json({ error: 'Invalid unit selected' });
        }

        const resolvedCategoryId = await getCategoryIdFromInput(category_id, category);
        const stocks = normalizeStocks({ stock, bank_stock, cash_stock });

        const result = await pool.query(
            `INSERT INTO products (name, category_id, brand, barcode, purchase_price, selling_price, stock, min_stock, unit, bank_stock, cash_stock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
                name.trim(),
                resolvedCategoryId,
                brand?.trim() || null,
                barcode?.trim() || null,
                purchase_price,
                selling_price,
                stocks.stock,
                min_stock || 10,
                normalizedUnit,
                stocks.bank_stock,
                stocks.cash_stock
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Create product error:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Barcode already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category_id, category, brand, barcode, purchase_price, selling_price, stock, min_stock, unit, bank_stock, cash_stock } = req.body;

        const normalizedUnit = getNormalizedUnit(unit);
        if (!normalizedUnit) {
            return res.status(400).json({ error: 'Invalid unit selected' });
        }

        const resolvedCategoryId = await getCategoryIdFromInput(category_id, category);
        const stocks = normalizeStocks({ stock, bank_stock, cash_stock });

        const result = await pool.query(
            `UPDATE products SET
                name=$1, category_id=$2, brand=$3, barcode=$4, purchase_price=$5,
                selling_price=$6, stock=$7, min_stock=$8, unit=$9, bank_stock=$10, cash_stock=$11, updated_at=NOW()
             WHERE id=$12 RETURNING *`,
            [
                name?.trim(),
                resolvedCategoryId,
                brand?.trim() || null,
                barcode?.trim() || null,
                purchase_price,
                selling_price,
                stocks.stock,
                min_stock,
                normalizedUnit,
                stocks.bank_stock,
                stocks.cash_stock,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update product error:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Barcode already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

const bulkPriceUpdate = async (req, res) => {
    const client = await pool.connect();
    try {
        const { updates } = req.body;
        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'Price updates array is required' });
        }

        await client.query('BEGIN');
        const updatedProducts = [];
        for (const item of updates) {
            const { id, purchase_price, selling_price } = item;
            if (!id || purchase_price === undefined || selling_price === undefined) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Each update requires id, purchase_price and selling_price' });
            }

            const result = await client.query(
                `UPDATE products SET purchase_price = $1, selling_price = $2, updated_at = NOW()
                 WHERE id = $3 AND is_active = true
                 RETURNING id, name, purchase_price, selling_price`,
                [purchase_price, selling_price, id]
            );

            if (result.rows.length > 0) updatedProducts.push(result.rows[0]);
        }

        await client.query('COMMIT');
        res.json({ message: `${updatedProducts.length} products updated successfully`, updated: updatedProducts });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Bulk price update error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE products SET is_deleted = true, is_active = false, updated_at = NOW() WHERE id = $1', [id]);
        res.json({ message: 'Product deleted' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, type, notes, source = 'bank' } = req.body;
        const product = await pool.query('SELECT stock, bank_stock, cash_stock FROM products WHERE id = $1', [id]);

        if (product.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const qty = Math.max(0, Number(quantity || 0));
        const previousBank = Number(product.rows[0].bank_stock || 0);
        const previousCash = Number(product.rows[0].cash_stock || 0);
        const previousStock = Number(product.rows[0].stock || 0);
        const targetSource = source === 'cash' ? 'cash' : 'bank';
        const bankStock = targetSource === 'bank'
            ? (type === 'add' ? previousBank + qty : previousBank - qty)
            : previousBank;
        const cashStock = targetSource === 'cash'
            ? (type === 'add' ? previousCash + qty : previousCash - qty)
            : previousCash;
        const newStock = bankStock + cashStock;

        await pool.query(
            'UPDATE products SET stock = $1, bank_stock = $2, cash_stock = $3, updated_at = NOW() WHERE id = $4',
            [newStock, bankStock, cashStock, id]
        );

        await pool.query(
            `INSERT INTO inventory_logs (product_id, change_type, quantity_change, previous_stock, new_stock, notes, user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, type === 'add' ? 'purchase' : 'adjustment', type === 'add' ? qty : -qty, previousStock, newStock, `${targetSource} stock${notes ? ` - ${notes}` : ''}`, req.user.id]
        );

        res.json({ message: 'Stock updated', newStock, bank_stock: bankStock, cash_stock: cashStock });
    } catch (error) {
        console.error('Update stock error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getLowStock = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, c.name as category_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.stock <= p.min_stock AND p.is_active = true
             ORDER BY p.stock, p.name`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Low stock error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getCategories = async (req, res) => {
    try {
        await ensureStandardCategories();
        const result = await pool.query('SELECT * FROM categories ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const createCategory = async (req, res) => {
    try {
        const { name } = req.body;
        const trimmedName = name?.trim();
        if (!trimmedName) return res.status(400).json({ error: 'Category name is required' });

        const existing = await pool.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [trimmedName]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Category already exists' });

        const result = await pool.query('INSERT INTO categories (name) VALUES ($1) RETURNING *', [trimmedName]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getProducts,
    getProductByBarcode,
    createProduct,
    updateProduct,
    bulkPriceUpdate,
    deleteProduct,
    updateStock,
    getLowStock,
    getCategories,
    createCategory,
    STANDARD_CATEGORIES,
    STANDARD_UNITS
};
