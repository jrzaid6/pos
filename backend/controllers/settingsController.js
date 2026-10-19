const pool = require('../config/database');
const { writeAudit } = require('../services/auditLogger');

const settingRules = {
    shop_name: { type: 'string', max: 200, required: true }, address: { type: 'string', max: 5000 },
    phone: { type: 'string', max: 20 }, email: { type: 'email', max: 100 }, gst_number: { type: 'string', max: 50 },
    currency: { type: 'string', max: 10 }, bill_prefix: { type: 'string', max: 10 }, logo_url: { type: 'string', max: 2000 },
    bill_footer: { type: 'string', max: 1000 }, thank_you_note: { type: 'string', max: 500 },
    gst_enabled: { type: 'boolean' }, tax_percent: { type: 'number', min: 0, max: 100 },
    financial_year_start: { type: 'financialDate' }, low_stock_threshold: { type: 'integer', min: 0, max: 1000000 },
    printer_type: { type: 'enum', values: ['58mm', '80mm'] }, invoice_format: { type: 'enum', values: ['thermal', 'a4'] },
    print_preview: { type: 'boolean' }, default_payment_method: { type: 'enum', values: ['cash', 'upi', 'udhar', 'split'] },
    default_customer_label: { type: 'string', max: 100 },
    default_report_period: { type: 'enum', values: ['today', 'week', 'month', 'year', 'financial-year'] },
    session_timeout_minutes: { type: 'integer', min: 1, max: 1440 }, theme: { type: 'enum', values: ['light', 'dark'] }
};

const validateSettings = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Settings body must be an object' };
    const entries = Object.entries(body);
    if (!entries.length) return { error: 'Provide at least one setting to update' };
    const values = {};
    for (const [key, rawValue] of entries) {
        const rule = settingRules[key];
        if (!rule) return { error: `Unknown setting: ${key}` };
        let value = rawValue;
        if (rule.type === 'string' || rule.type === 'email') {
            if (typeof value !== 'string') return { error: `${key} must be text` };
            value = value.trim();
            if (value.length > rule.max || (rule.required && !value)) return { error: `${key} is invalid` };
            if (rule.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: 'Enter a valid shop email' };
        } else if (rule.type === 'boolean') {
            if (typeof value !== 'boolean') return { error: `${key} must be true or false` };
        } else if (rule.type === 'number' || rule.type === 'integer') {
            if (value === '' || value === null || !Number.isFinite(Number(value))) return { error: `${key} must be a number` };
            value = Number(value);
            if (value < rule.min || value > rule.max || (rule.type === 'integer' && !Number.isInteger(value))) return { error: `${key} is outside the allowed range` };
        } else if (rule.type === 'enum') {
            if (!rule.values.includes(value)) return { error: `${key} has an unsupported value` };
        } else if (rule.type === 'financialDate') {
            if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return { error: 'Financial year start must use MM-DD format' };
            const [month, day] = value.split('-').map(Number);
            const date = new Date(Date.UTC(2024, month - 1, day));
            if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { error: 'Financial year start is not a valid date' };
        }
        values[key] = value;
    }
    return { values };
};

const isValidIsoDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const logAudit = async ({ userId, action, targetType, targetId, details }) => {
    return writeAudit(pool, { userId, action, targetType, targetId, details });
};

const getSettings = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM shop_settings LIMIT 1');
        res.json(result.rows[0] || {});
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateSettings = async (req, res) => {
    const validation = validateSettings(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });
    const updates = validation.values;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const previous = await client.query('SELECT * FROM shop_settings WHERE id = 1 FOR UPDATE');
        if (!previous.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Shop settings are not initialized' });
        }
        const keys = Object.keys(updates);
        const assignments = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
        const result = await client.query(
            `UPDATE shop_settings SET ${assignments}, updated_at = NOW() WHERE id = 1 RETURNING *`,
            keys.map((key) => updates[key])
        );
        const changed = Object.fromEntries(keys.filter((key) => previous.rows[0][key] !== result.rows[0][key])
            .map((key) => [key, { from: previous.rows[0][key], to: result.rows[0][key] }]));
        await writeAudit(client, {
            userId: req.user.id, action: 'update_settings', targetType: 'shop_settings', targetId: 1,
            details: { changed }
        });
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const updateTheme = async (req, res) => {
    try {
        const { theme } = req.body;
        if (!['light', 'dark'].includes(String(theme))) {
            return res.status(400).json({ error: 'Invalid theme. Allowed: light, dark' });
        }

        const result = await pool.query(
            `UPDATE shop_settings SET theme = $1, updated_at = NOW() WHERE id = 1 RETURNING *`,
            [theme]
        );

        await logAudit({
            userId: req.user.id,
            action: 'update_theme',
            targetType: 'shop_settings',
            targetId: 1,
            details: `Theme set to ${theme}`
        });

        res.json(result.rows[0] || { theme });
    } catch (error) {
        console.error('Update theme error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getReports = async (req, res) => {
    try {
        const { period = 'today' } = req.query;
        let dateCondition;
        let dateParams = [];
        switch (period) {
            case 'today':
                dateCondition = "DATE(created_at) = CURRENT_DATE";
                break;
            case 'week':
                dateCondition = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
                break;
            case 'month':
                dateCondition = "created_at >= CURRENT_DATE - INTERVAL '30 days'";
                break;
            case 'year':
                dateCondition = "created_at >= CURRENT_DATE - INTERVAL '365 days'";
                break;
            case 'financial-year': {
                const [settingResult, dateResult] = await Promise.all([
                    pool.query('SELECT financial_year_start FROM shop_settings WHERE id = 1'),
                    pool.query('SELECT CURRENT_DATE::text AS today')
                ]);
                const startValue = settingResult.rows[0]?.financial_year_start || '04-01';
                if (!/^\d{2}-\d{2}$/.test(startValue)) return res.status(500).json({ error: 'Financial year start setting is invalid' });
                const [month, day] = startValue.split('-').map(Number);
                const today = dateResult.rows[0].today;
                const candidate = `${today.slice(0, 4)}-${startValue}`;
                const startYear = today >= candidate ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
                const from = `${startYear}-${startValue}`;
                const to = `${startYear + 1}-${startValue}`;
                const check = new Date(Date.UTC(2024, month - 1, day));
                if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return res.status(500).json({ error: 'Financial year start setting is invalid' });
                dateCondition = 'created_at >= $1::date AND created_at < $2::date';
                dateParams = [from, to];
                break;
            }
            default:
                dateCondition = "DATE(created_at) = CURRENT_DATE";
        }
        
        const salesSummary = await pool.query(`
            SELECT 
                COUNT(*) as total_bills,
                COALESCE(SUM(total_amount), 0) as total_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'upi' THEN total_amount ELSE 0 END), 0) as upi_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'udhar' THEN total_amount ELSE 0 END), 0) as udhar_sales,
                COALESCE(SUM(discount), 0) as total_discount
            FROM sales
            WHERE ${dateCondition} AND is_deleted = false
        `, dateParams);
        
        const topProducts = await pool.query(`
            SELECT p.name, SUM(si.quantity) as total_qty, SUM(si.total) as total_revenue
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            WHERE ${dateCondition.replace(/created_at/g, 's.created_at')} AND s.is_deleted = false
            GROUP BY p.id, p.name
            ORDER BY total_qty DESC
            LIMIT 10
        `, dateParams);
        
        const dailyBreakdown = await pool.query(`
            SELECT DATE(created_at) as date, 
                   COUNT(*) as bills,
                   COALESCE(SUM(total_amount), 0) as sales
            FROM sales
            WHERE ${dateCondition} AND is_deleted = false
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 30
        `, dateParams);
        
        res.json({
            summary: salesSummary.rows[0],
            topProducts: topProducts.rows,
            dailyBreakdown: dailyBreakdown.rows
        });
    } catch (error) {
        console.error('Reports error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getInventoryReport = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_products,
                COALESCE(SUM(stock), 0) as total_stock,
                COALESCE(SUM(stock * purchase_price), 0) as stock_value,
                COALESCE(SUM(stock * selling_price), 0) as potential_revenue,
                COUNT(CASE WHEN stock <= min_stock THEN 1 END) as low_stock_count
            FROM products
            WHERE is_active = true
        `);
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const getAuditLogs = async (req, res) => {
    try {
        const page = Math.min(1000000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
        const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25));
        const conditions = [];
        const params = [];
        const addCondition = (sql, value) => {
            params.push(value);
            conditions.push(sql.replace('?', `$${params.length}`));
        };
        if (req.query.userId !== undefined) {
            if (!/^\d+$/.test(String(req.query.userId)) || Number(req.query.userId) < 1) return res.status(400).json({ error: 'userId must be a positive integer' });
            addCondition('a.user_id = ?', Number(req.query.userId));
        }
        if (req.query.action) addCondition('a.action ILIKE ?', `%${String(req.query.action).slice(0, 100)}%`);
        if (req.query.from) {
            if (!isValidIsoDate(req.query.from)) return res.status(400).json({ error: 'from must be a valid YYYY-MM-DD date' });
            addCondition('a.created_at >= ?::date', String(req.query.from));
        }
        if (req.query.to) {
            if (!isValidIsoDate(req.query.to)) return res.status(400).json({ error: 'to must be a valid YYYY-MM-DD date' });
            addCondition("a.created_at < (?::date + INTERVAL '1 day')", String(req.query.to));
        }
        if (req.query.from && req.query.to && req.query.from > req.query.to) return res.status(400).json({ error: 'from cannot be after to' });
        if (req.query.q) {
            const pattern = `%${String(req.query.q).slice(0, 120)}%`;
            params.push(pattern);
            const placeholder = `$${params.length}`;
            conditions.push(`(u.name ILIKE ${placeholder} OR a.action ILIKE ${placeholder} OR a.target_type ILIKE ${placeholder} OR a.details ILIKE ${placeholder})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const count = await pool.query(
            `SELECT COUNT(*)::int AS total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id ${where}`,
            params
        );
        const offset = (page - 1) * pageSize;
        const pageParams = [...params, pageSize, offset];
        const result = await pool.query(`
            SELECT a.*, u.name as user_name
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ${where}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
        `, pageParams);
        const total = count.rows[0].total;
        res.json({ items: result.rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const getBackupData = async (req, res) => {
    const supportedTables = [
        'categories', 'users', 'products', 'customers', 'sales', 'sale_items', 'credit_payments',
        'inventory_logs', 'suppliers', 'vendors', 'purchase_entries', 'bank_cash_transactions',
        'vendor_payments', 'vendor_payment_allocations', 'vendor_requests', 'purchase_returns', 'shop_settings', 'audit_logs'
    ];
    const client = await pool.connect();
    let clientReleased = false;
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const existingResult = await client.query(
            'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
            ['public', supportedTables]
        );
        const existing = new Set(existingResult.rows.map((row) => row.table_name));
        const tables = {};
        for (const table of supportedTables) {
            if (!existing.has(table)) continue;
            const selection = table === 'users'
                ? 'id, name, email, role, is_active, is_deleted, created_at, updated_at'
                : '*';
            tables[table] = (await client.query(`SELECT ${selection} FROM "${table}" ORDER BY ${table === 'vendor_requests' ? 'request_key' : 'id'}`)).rows;
        }
        await client.query('COMMIT');
        client.release();
        clientReleased = true;
        const backup = { format_version: 2, exported_at: new Date().toISOString(), app: 'MMTC POS', tables };
        await logAudit({
            userId: req.user.id,
            action: 'backup_export',
            targetType: 'system',
            targetId: null,
            details: { exported_tables: Object.keys(tables) }
        });
        res.json(backup);
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('Backup export error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (!clientReleased) client.release();
    }
};

module.exports = { getSettings, updateSettings, updateTheme, getReports, getInventoryReport, getAuditLogs, getBackupData };
