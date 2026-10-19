const pool = require('../config/database');

const customerSummaryQuery = `
    SELECT c.*, 
           COALESCE(SUM(CASE WHEN cp.payment_type = 'credit' THEN cp.amount ELSE -cp.amount END), 0) + COALESCE(c.opening_balance, 0) as pending_balance,
           COALESCE(COUNT(DISTINCT s.id), 0) as total_orders,
           COALESCE(SUM(s.total_amount), 0) as total_purchase,
           MAX(s.created_at) as last_order_date
    FROM customers c
    LEFT JOIN credit_payments cp ON c.id = cp.customer_id
    LEFT JOIN sales s ON c.id = s.customer_id
    WHERE c.is_active = true
    GROUP BY c.id
`;

// Get all customers with summary
const getCustomers = async (req, res) => {
    try {
        const result = await pool.query(`
            ${customerSummaryQuery}
            ORDER BY pending_balance DESC, c.name
        `);
        res.json(req.user.role === 'cashier'
            ? result.rows.map(({ id, name, phone, customer_type }) => ({ id, name, phone, customer_type })).sort((a, b) => a.name.localeCompare(b.name))
            : result.rows);
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Get customer by ID with balance + summary
const getCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        
        const customer = await pool.query(`
            ${customerSummaryQuery}
            AND c.id = $1
            GROUP BY c.id
        `, [id]);
        
        if (customer.rows.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        res.json(customer.rows[0]);
    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Create customer
const createCustomer = async (req, res) => {
    try {
        const { 
            name, phone, address, shop_name, contact_person, area, customer_type,
            gst_number, credit_limit, opening_balance, notes 
        } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name required' });
        }
        const isCashier = req.user.role === 'cashier';
        
        const result = await pool.query(
            `INSERT INTO customers 
             (name, phone, address, shop_name, contact_person, area, customer_type, gst_number, credit_limit, opening_balance, notes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
             RETURNING *`,
            [
                name,
                phone || null,
                isCashier ? null : (address || null),
                isCashier ? null : (shop_name || null),
                isCashier ? null : (contact_person || null),
                isCashier ? null : (area || null),
                customer_type || 'wholesale',
                isCashier ? null : (gst_number || null),
                isCashier ? 0 : (credit_limit || 0),
                isCashier ? 0 : (opening_balance || 0),
                isCashier ? null : (notes || null)
            ]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Create customer error:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Phone number already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

// Update customer
const updateCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            name, phone, address, shop_name, contact_person, area, customer_type,
            gst_number, credit_limit, opening_balance, notes 
        } = req.body;
        
        const result = await pool.query(
            `UPDATE customers SET 
                name=$1, phone=$2, address=$3, shop_name=$4, contact_person=$5, area=$6,
                customer_type=$7, gst_number=$8, credit_limit=$9, opening_balance=$10, notes=$11,
                updated_at=NOW() 
             WHERE id=$12 RETURNING *`,
            [
                name,
                phone || null,
                address || null,
                shop_name || null,
                contact_person || null,
                area || null,
                customer_type || 'wholesale',
                gst_number || null,
                credit_limit || 0,
                opening_balance || 0,
                notes || null,
                id
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update customer error:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Phone number already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

// Delete customer (Soft delete)
const deleteCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE customers SET is_deleted = true, is_active = false, updated_at = NOW() WHERE id = $1', [id]);
        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Get customer purchase history
const getCustomerHistory = async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT s.*, 
                   json_agg(json_build_object(
                       'product_name', p.name,
                       'quantity', si.quantity,
                       'price', si.price,
                       'total', si.total
                   ) ORDER BY si.id) as items
            FROM sales s
            LEFT JOIN sale_items si ON s.id = si.sale_id
            LEFT JOIN products p ON si.product_id = p.id
            WHERE s.customer_id = $1
            GROUP BY s.id
            ORDER BY s.created_at DESC
            LIMIT 50
        `, [id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Get customers with pending balance
const getCustomersWithBalance = async (req, res) => {
    try {
        const result = await pool.query(`
            ${customerSummaryQuery}
            HAVING COALESCE(SUM(CASE WHEN cp.payment_type = 'credit' THEN cp.amount ELSE -cp.amount END), 0) + COALESCE(c.opening_balance, 0) > 0
            ORDER BY pending_balance DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Customers with balance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { 
    getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, 
    getCustomerHistory, getCustomersWithBalance 
};
