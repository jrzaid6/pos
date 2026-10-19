const pool = require('../config/database');

const getDateRangeFromPeriod = (period, from, to) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (period) {
        case 'today': return { from: today, to: now };
        case 'week': {
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - 6);
            return { from: weekStart, to: now };
        }
        case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
        case 'year': return { from: new Date(now.getFullYear(), 0, 1), to: now };
        case 'financial-year': {
            const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
            return { from: new Date(fyStartYear, 3, 1), to: now };
        }
        case 'custom': return from && to ? { from: new Date(from), to: new Date(`${to}T23:59:59`) } : null;
        default: return null;
    }
};

const buildSalesWhere = ({ period, from, to, customer_id, payment_method, cashier_id, category_id }, alias = 's') => {
    const conditions = [];
    const params = [];
    const range = getDateRangeFromPeriod(period, from, to);

    if (range) {
        params.push(range.from, range.to);
        conditions.push(`${alias}.created_at BETWEEN $${params.length - 1} AND $${params.length}`);
    }
    if (customer_id) {
        params.push(customer_id);
        conditions.push(`${alias}.customer_id = $${params.length}`);
    }
    if (payment_method && payment_method !== 'all') {
        params.push(payment_method);
        conditions.push(`${alias}.payment_method = $${params.length}`);
    }
    if (cashier_id) {
        params.push(cashier_id);
        conditions.push(`${alias}.user_id = $${params.length}`);
    }
    if (category_id) {
        params.push(category_id);
        conditions.push(`EXISTS (
            SELECT 1
            FROM sale_items si_filter
            JOIN products p_filter ON p_filter.id = si_filter.product_id
            WHERE si_filter.sale_id = ${alias}.id
              AND p_filter.category_id = $${params.length}
        )`);
    }

    return { whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
};

const isValidReportDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const buildReportWhere = async (filters, alias = 's', ignorePeriod = false) => {
    const { period = 'month', from, to, customer_id, payment_method, cashier_id, category_id } = filters;
    const conditions = [`${alias}.is_deleted = false`];
    const params = [];
    const selectedPeriod = ignorePeriod ? 'all' : period;
    if (!['today', 'week', 'month', 'year', 'financial-year', 'all', 'custom'].includes(selectedPeriod)) {
        const error = new Error('Unsupported report period'); error.status = 400; throw error;
    }
    if (selectedPeriod === 'today') conditions.push(`DATE(${alias}.created_at) = CURRENT_DATE`);
    if (selectedPeriod === 'week') conditions.push(`DATE(${alias}.created_at) BETWEEN DATE_TRUNC('week', CURRENT_DATE)::date AND CURRENT_DATE`);
    if (selectedPeriod === 'month') conditions.push(`DATE(${alias}.created_at) BETWEEN DATE_TRUNC('month', CURRENT_DATE)::date AND CURRENT_DATE`);
    if (selectedPeriod === 'year') conditions.push(`DATE(${alias}.created_at) BETWEEN DATE_TRUNC('year', CURRENT_DATE)::date AND CURRENT_DATE`);
    if (selectedPeriod === 'financial-year') {
        const settings = await pool.query('SELECT financial_year_start, CURRENT_DATE::text AS today FROM shop_settings WHERE id = 1');
        const start = settings.rows[0]?.financial_year_start || '04-01';
        const [month, day] = String(start).split('-').map(Number);
        const validStart = /^\d{2}-\d{2}$/.test(start) && new Date(Date.UTC(2023, month - 1, day)).getUTCMonth() === month - 1 && new Date(Date.UTC(2023, month - 1, day)).getUTCDate() === day;
        if (!validStart || !settings.rows[0]?.today) { const error = new Error('Financial year setting is invalid'); error.status = 400; throw error; }
        const today = settings.rows[0].today;
        const year = Number(today.slice(0, 4));
        const startYear = today >= `${year}-${start}` ? year : year - 1;
        params.push(`${startYear}-${start}`, today);
        conditions.push(`DATE(${alias}.created_at) BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }
    if (selectedPeriod === 'custom') {
        if (!isValidReportDate(from) || !isValidReportDate(to) || from > to) { const error = new Error('Choose a valid start and end date'); error.status = 400; throw error; }
        params.push(from, to);
        conditions.push(`DATE(${alias}.created_at) BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }
    if (customer_id) { params.push(customer_id); conditions.push(`${alias}.customer_id = $${params.length}`); }
    if (payment_method && payment_method !== 'all') {
        if (!['cash', 'upi', 'udhar', 'split'].includes(payment_method)) { const error = new Error('Unsupported payment filter'); error.status = 400; throw error; }
        params.push(payment_method); conditions.push(`${alias}.payment_method = $${params.length}`);
    }
    if (cashier_id) { params.push(cashier_id); conditions.push(`${alias}.user_id = $${params.length}`); }
    if (category_id) {
        params.push(category_id);
        conditions.push(`EXISTS (SELECT 1 FROM sale_items si_filter JOIN products p_filter ON p_filter.id = si_filter.product_id WHERE si_filter.sale_id = ${alias}.id AND p_filter.category_id = $${params.length})`);
    }
    return { whereClause: `WHERE ${conditions.join(' AND ')}`, params };
};

const paymentExpressions = (alias = 's') => {
    const cash = `GREATEST(COALESCE((${alias}.payment_breakdown->>'cash')::numeric, 0), 0)`;
    const upi = `GREATEST(COALESCE((${alias}.payment_breakdown->>'upi')::numeric, 0), 0)`;
    const credit = `GREATEST(COALESCE((${alias}.payment_breakdown->>'credit')::numeric, 0), 0)`;
    const hasBreakdown = `(${cash} + ${upi} + ${credit} > 0)`;
    return {
        cash: `CASE WHEN ${hasBreakdown} THEN ${cash} WHEN ${alias}.payment_method = 'cash' THEN ${alias}.total_amount ELSE 0 END`,
        upi: `CASE WHEN ${hasBreakdown} THEN ${upi} WHEN ${alias}.payment_method = 'upi' THEN ${alias}.total_amount ELSE 0 END`,
        credit: `CASE WHEN ${hasBreakdown} THEN ${credit} WHEN ${alias}.payment_method = 'udhar' THEN ${alias}.total_amount ELSE 0 END`,
        missingSplit: `CASE WHEN ${alias}.payment_method = 'split' AND NOT ${hasBreakdown} THEN ${alias}.total_amount ELSE 0 END`
    };
};

const getComparisonRange = async (period, from, to) => {
    if (period === 'all') return null;
    const result = await pool.query('SELECT CURRENT_DATE::text AS today, financial_year_start FROM shop_settings WHERE id = 1');
    const today = result.rows[0]?.today;
    if (!today) return null;
    const shiftDays = (value, days) => {
        const date = new Date(`${value}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    };
    const yearStart = (value) => {
        const [month, day] = String(value || '04-01').split('-').map(Number);
        const currentYear = Number(today.slice(0, 4));
        const candidate = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return today >= candidate ? candidate : `${currentYear - 1}-${candidate.slice(5)}`;
    };
    if (period === 'today') return { from: shiftDays(today, -1), to: shiftDays(today, -1) };
    if (period === 'week') {
        const date = new Date(`${today}T00:00:00Z`);
        const mondayOffset = (date.getUTCDay() + 6) % 7;
        const thisWeekStart = shiftDays(today, -mondayOffset);
        const previousWeekStart = shiftDays(thisWeekStart, -7);
        return { from: previousWeekStart, to: shiftDays(previousWeekStart, mondayOffset) };
    }
    if (period === 'month') {
        const date = new Date(`${today}T00:00:00Z`);
        const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
        const previousStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
        const previousMonthLength = new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth() + 1, 0)).getUTCDate();
        previousStart.setUTCDate(Math.min(date.getUTCDate(), previousMonthLength));
        return { from: new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth(), 1)).toISOString().slice(0, 10), to: previousStart.toISOString().slice(0, 10) };
    }
    if (period === 'year') {
        const date = new Date(`${today}T00:00:00Z`);
        const previous = new Date(Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), Math.min(date.getUTCDate(), new Date(Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth() + 1, 0)).getUTCDate())));
        return { from: `${date.getUTCFullYear() - 1}-01-01`, to: previous.toISOString().slice(0, 10) };
    }
    if (period === 'financial-year') {
        const currentStart = yearStart(result.rows[0].financial_year_start);
        const startDate = new Date(`${currentStart}T00:00:00Z`);
        startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        const elapsedDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${currentStart}T00:00:00Z`)) / 86400000);
        return { from: startDate.toISOString().slice(0, 10), to: shiftDays(startDate.toISOString().slice(0, 10), elapsedDays) };
    }
    if (period === 'custom' && isValidReportDate(from) && isValidReportDate(to) && from <= to) {
        const numberOfDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
        const previousTo = shiftDays(from, -1);
        return { from: shiftDays(previousTo, -(numberOfDays - 1)), to: previousTo };
    }
    return null;
};

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const buildPaymentBreakdown = (paymentMethod, paymentBreakdown = {}, totalAmount = 0) => {
    const breakdown = {
        cash: roundMoney(paymentBreakdown.cash),
        upi: roundMoney(paymentBreakdown.upi),
        credit: roundMoney(paymentBreakdown.credit)
    };

    if (paymentMethod === 'cash') return { cash: roundMoney(totalAmount), upi: 0, credit: 0 };
    if (paymentMethod === 'upi') return { cash: 0, upi: roundMoney(totalAmount), credit: 0 };
    if (paymentMethod === 'udhar') return { cash: 0, upi: 0, credit: roundMoney(totalAmount) };
    return breakdown;
};

const { processSale } = require('../services/saleService');

const createSale = async (req, res) => {
    try {
        const sale = await processSale(req.body, req.user.id, req.user.role);

        const completeSale = await pool.query(`
            SELECT s.*, c.name as customer_name, c.phone as customer_phone, u.name as cashier_name,
                json_agg(json_build_object(
                    'product_id', p.id,
                    'product_name', p.name,
                    'quantity', si.quantity,
                    'price', si.price,
                    'total', si.total,
                    'unit', p.unit,
                    'stock_source', si.stock_source
                ) ORDER BY si.id) as items
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN sale_items si ON s.id = si.sale_id
            LEFT JOIN products p ON si.product_id = p.id
            WHERE s.id = $1 AND s.is_deleted = false
            GROUP BY s.id, c.name, c.phone, u.name
        `, [sale.id]);

        res.status(201).json(completeSale.rows[0]);
    } catch (error) {
        console.error('Sale error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

const getSales = async (req, res) => {
    try {
        const { period = 'all', from, to, customer_id, payment_method, cashier_id, category_id, limit = 5000 } = req.query;
        const effectiveCashierId = req.user.role === 'cashier' ? req.user.id : cashier_id;
        const { whereClause, params } = buildSalesWhere({ period, from, to, customer_id, payment_method, cashier_id: effectiveCashierId, category_id });
        const query = `
            SELECT s.*, c.name as customer_name, u.name as cashier_name
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            ${whereClause}
            ORDER BY s.created_at DESC
            LIMIT $${params.length + 1}
        `;
        const result = await pool.query(query, [...params, Number(limit)]);
        res.json(result.rows);
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getSalesAnalytics = async (req, res) => {
    try {
        const filters = { ...req.query, period: req.query.period || 'month' };
        let page = Math.min(1_000_000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
        const pageSize = Math.min(50, Math.max(10, Number.parseInt(req.query.pageSize, 10) || 25));
        const q = String(req.query.q || '').trim().slice(0, 120);
        const { whereClause, params } = await buildReportWhere(filters, 's');
        const payments = paymentExpressions('s');
        const comparisonRange = await getComparisonRange(filters.period, filters.from, filters.to);
        let comparison = null;
        if (comparisonRange) {
            const compareFilters = { ...filters, period: 'custom', from: comparisonRange.from, to: comparisonRange.to };
            const { whereClause: comparisonWhere, params: comparisonParams } = await buildReportWhere(compareFilters, 's');
            const comparisonResult = await pool.query(`
                SELECT COUNT(*)::int AS total_bills,
                    COALESCE(SUM(s.total_amount), 0) AS total_sales,
                    COALESCE(AVG(s.total_amount), 0) AS avg_bill_value
                FROM sales s ${comparisonWhere}
            `, comparisonParams);
            comparison = { ...comparisonResult.rows[0], from: comparisonRange.from, to: comparisonRange.to };
        }

        const summaryResult = await pool.query(`
            SELECT COUNT(*)::int AS total_bills,
                COALESCE(SUM(s.total_amount), 0) AS total_sales,
                COALESCE(SUM(s.subtotal), 0) AS subtotal,
                COALESCE(SUM(s.discount), 0) AS total_discount,
                COALESCE(AVG(s.total_amount), 0) AS avg_bill_value,
                COALESCE(SUM(${payments.cash}), 0) AS cash_sales,
                COALESCE(SUM(${payments.upi}), 0) AS upi_sales,
                COALESCE(SUM(${payments.credit}), 0) AS credit_sales,
                COALESCE(SUM(${payments.missingSplit}), 0) AS unclassified_split_amount,
                COUNT(*) FILTER (WHERE (${payments.cash}) > 0)::int AS cash_bills,
                COUNT(*) FILTER (WHERE (${payments.upi}) > 0)::int AS upi_bills,
                COUNT(*) FILTER (WHERE (${payments.credit}) > 0)::int AS credit_bills
            FROM sales s ${whereClause}
        `, params);

        const timelineResult = await pool.query(`
            SELECT DATE(s.created_at) AS date, COUNT(*)::int AS bills,
                COALESCE(SUM(s.total_amount), 0) AS sales,
                COALESCE(SUM(${payments.cash}), 0) AS cash_sales,
                COALESCE(SUM(${payments.upi}), 0) AS upi_sales,
                COALESCE(SUM(${payments.credit}), 0) AS credit_sales
            FROM sales s ${whereClause}
            GROUP BY DATE(s.created_at) ORDER BY DATE(s.created_at) DESC LIMIT 45
        `, params);

        const topProductsResult = await pool.query(`
            SELECT p.id, p.name, p.unit, COALESCE(SUM(si.quantity), 0) AS total_qty,
                COALESCE(SUM(si.total * CASE WHEN s.subtotal > 0 THEN s.total_amount / s.subtotal ELSE 0 END), 0) AS net_revenue,
                COUNT(DISTINCT s.id)::int AS bill_count
            FROM sales s JOIN sale_items si ON si.sale_id = s.id
            JOIN products p ON p.id = si.product_id ${whereClause}
            GROUP BY p.id, p.name, p.unit ORDER BY total_qty DESC, net_revenue DESC LIMIT 10
        `, params);

        const categoryBreakdownResult = await pool.query(`
            SELECT COALESCE(c.name, 'General') AS category_name, p.category_id,
                COALESCE(SUM(si.quantity), 0) AS qty,
                COALESCE(SUM(si.total * CASE WHEN s.subtotal > 0 THEN s.total_amount / s.subtotal ELSE 0 END), 0) AS net_sales
            FROM sales s JOIN sale_items si ON si.sale_id = s.id
            JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
            ${whereClause} GROUP BY p.category_id, c.name ORDER BY net_sales DESC LIMIT 20
        `, params);

        const cashierResult = await pool.query(`
            SELECT s.user_id, COALESCE(u.name, 'Unknown') AS cashier_name,
                COUNT(*)::int AS bills, COALESCE(SUM(s.total_amount), 0) AS net_sales
            FROM sales s LEFT JOIN users u ON u.id = s.user_id ${whereClause}
            GROUP BY s.user_id, u.name ORDER BY net_sales DESC LIMIT 20
        `, params);

        const listParams = [...params];
        let listWhere = whereClause;
        if (q) {
            listParams.push(`%${q}%`);
            const searchParam = `$${listParams.length}`;
            listWhere += ` AND (s.bill_number ILIKE ${searchParam} OR COALESCE(c.name, 'Walk-in') ILIKE ${searchParam} OR COALESCE(u.name, '') ILIKE ${searchParam})`;
        }
        const salesCountResult = await pool.query(`
            SELECT COUNT(*)::int AS total FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
            ${listWhere}
        `, listParams);
        const totalFiltered = salesCountResult.rows[0].total;
        page = Math.min(page, Math.max(1, Math.ceil(totalFiltered / pageSize)));
        const offset = (page - 1) * pageSize;
        const salesResult = await pool.query(`
            SELECT s.id, s.bill_number, s.created_at, s.total_amount, s.payment_method,
                s.payment_breakdown, s.discount, s.balance_due, s.amount_paid,
                COALESCE(c.name, 'Walk-in') AS customer_name, COALESCE(u.name, 'Unknown') AS cashier_name
            FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
            ${listWhere} ORDER BY s.created_at DESC, s.id DESC LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}
        `, [...listParams, pageSize, offset]);

        const creditFilters = { period: 'all', payment_method: 'all' };
        const { whereClause: creditWhere, params: creditParams } = await buildReportWhere(creditFilters, 's', true);
        const creditAgingResult = await pool.query(`
            SELECT COALESCE(SUM(CASE WHEN CURRENT_DATE - DATE(s.created_at) <= 7 THEN s.balance_due ELSE 0 END), 0) AS bucket_0_7,
                COALESCE(SUM(CASE WHEN CURRENT_DATE - DATE(s.created_at) BETWEEN 8 AND 30 THEN s.balance_due ELSE 0 END), 0) AS bucket_8_30,
                COALESCE(SUM(CASE WHEN CURRENT_DATE - DATE(s.created_at) > 30 THEN s.balance_due ELSE 0 END), 0) AS bucket_30_plus,
                COALESCE(SUM(s.balance_due), 0) AS total_due
            FROM sales s ${creditWhere} AND s.balance_due > 0
        `, creditParams);
        const overdueResult = await pool.query(`
            SELECT c.id AS customer_id, COALESCE(c.name, 'Walk-in') AS customer_name,
                COALESCE(c.phone, '-') AS customer_phone, SUM(s.balance_due) AS due_amount,
                MIN(s.created_at) AS oldest_due_date
            FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${creditWhere} AND s.balance_due > 0
            GROUP BY c.id, c.name, c.phone ORDER BY due_amount DESC LIMIT 10
        `, creditParams);

        const summary = summaryResult.rows[0];
        res.json({
            summary,
            timeline: timelineResult.rows,
            paymentBreakdown: [
                { payment_method: 'cash', amount: summary.cash_sales, bills: summary.cash_bills },
                { payment_method: 'upi', amount: summary.upi_sales, bills: summary.upi_bills },
                { payment_method: 'credit', amount: summary.credit_sales, bills: summary.credit_bills }
            ],
            topProducts: topProductsResult.rows,
            categoryBreakdown: categoryBreakdownResult.rows,
            cashierBreakdown: cashierResult.rows,
            recentSales: salesResult.rows,
            salesPagination: { page, pageSize, total: totalFiltered, totalPages: Math.ceil(totalFiltered / pageSize) },
            creditAging: creditAgingResult.rows[0],
            overdueCustomers: overdueResult.rows,
            comparison,
            period: filters.period,
            filters: { period: filters.period, from: filters.from, to: filters.to, customer_id: filters.customer_id, payment_method: filters.payment_method, cashier_id: filters.cashier_id, category_id: filters.category_id, q }
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error('Sales analytics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getSale = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT s.*, c.name as customer_name, c.phone as customer_phone, u.name as cashier_name,
                   json_agg(json_build_object(
                       'product_id', p.id,
                       'product_name', p.name,
                       'quantity', si.quantity,
                       'price', si.price,
                       'total', si.total,
                       'unit', p.unit,
                       'stock_source', si.stock_source
                   ) ORDER BY si.id) as items
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN sale_items si ON s.id = si.sale_id
            LEFT JOIN products p ON si.product_id = p.id
            WHERE s.id = $1
            GROUP BY s.id, c.name, c.phone, u.name
        `, [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Sale not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get sale error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getTodaySummary = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as total_bills,
                COALESCE(SUM(total_amount), 0) as total_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'upi' THEN total_amount ELSE 0 END), 0) as upi_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'udhar' THEN total_amount ELSE 0 END), 0) as udhar_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'split' THEN total_amount ELSE 0 END), 0) as split_sales
            FROM sales
            WHERE DATE(created_at) = CURRENT_DATE AND is_deleted = false
        `);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Today summary error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { createSale, getSales, getSalesAnalytics, getSale, getTodaySummary };
