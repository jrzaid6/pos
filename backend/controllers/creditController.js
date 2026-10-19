const pool = require('../config/database');

// Get customer ledger
const getCustomerLedger = async (req, res) => {
    try {
        const { customer_id } = req.params;
        
        const result = await pool.query(`
            SELECT cp.*, s.bill_number
            FROM credit_payments cp
            LEFT JOIN sales s ON cp.sale_id = s.id
            WHERE cp.customer_id = $1
            ORDER BY cp.created_at DESC
        `, [customer_id]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Record payment (Improved for Bill-wise Settlement)
const recordPayment = async (req, res) => {
    const { customer_id, amount, notes, payment_method = 'cash', bill_id } = req.body || {};
    const amountValue = Number(amount);
    const customerId = Number(customer_id);
    const billId = bill_id ? Number(bill_id) : null;

    if (!Number.isInteger(customerId) || customerId <= 0 || !Number.isFinite(amountValue) || amountValue <= 0) {
        return res.status(400).json({ error: 'Choose a customer and enter a valid payment amount' });
    }
    if (!['cash', 'upi'].includes(payment_method)) {
        return res.status(400).json({ error: 'Payment method must be cash or UPI' });
    }
    if (billId !== null && (!Number.isInteger(billId) || billId <= 0)) {
        return res.status(400).json({ error: 'Choose a valid bill' });
    }

    const client = await pool.connect();
    let transactionStarted = false;
    try {
        await client.query('BEGIN');
        transactionStarted = true;

        const customerResult = await client.query(
            'SELECT id FROM customers WHERE id = $1 AND is_deleted = false FOR KEY SHARE', [customerId]
        );
        if (!customerResult.rows.length) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return res.status(404).json({ error: 'Customer not found' });
        }

        let sale = null;
        if (billId !== null) {
            const saleResult = await client.query(
                `SELECT id, balance_due, amount_paid FROM sales
                 WHERE id = $1 AND customer_id = $2 AND is_deleted = false FOR UPDATE`,
                [billId, customerId]
            );
            sale = saleResult.rows[0];
            if (!sale) {
                await client.query('ROLLBACK');
                transactionStarted = false;
                return res.status(404).json({ error: 'Unpaid bill not found for this customer' });
            }
            const currentDue = Number(sale.balance_due || 0);
            if (currentDue <= 0) {
                await client.query('ROLLBACK');
                transactionStarted = false;
                return res.status(400).json({ error: 'This bill has no outstanding amount' });
            }
            if (amountValue > currentDue + 0.005) {
                await client.query('ROLLBACK');
                transactionStarted = false;
                return res.status(400).json({ error: 'Payment cannot be greater than the bill balance' });
            }
        }

        // 1. Record the credit payment
        const paymentResult = await client.query(
            `INSERT INTO credit_payments (customer_id, amount, payment_type, payment_method, notes, sale_id)
             VALUES ($1, $2, 'payment', $3, $4, $5) RETURNING *`,
            [customerId, amountValue, payment_method, notes || null, billId]
        );

        // 2. If a specific bill is targeted, update that bill's status
        if (sale) {
            const currentDue = Number(sale.balance_due || 0);
            const newDue = Math.max(0, Number((currentDue - amountValue).toFixed(2)));
            const newPaid = Number((Number(sale.amount_paid || 0) + amountValue).toFixed(2));
            await client.query(
                `UPDATE sales SET amount_paid = $1, balance_due = $2, payment_status = $3 WHERE id = $4`,
                [newPaid, newDue, newDue === 0 ? 'paid' : 'partial', billId]
            );
        }

        // 3. Add to bank/cash transaction log
        const section = payment_method === 'cash' ? 'cash' : 'bank';
        await client.query(
            `INSERT INTO bank_cash_transactions (section, transaction_type, amount, payment_method, reference, note, meta)
             VALUES ($1, 'credit_payment', $2, $3, $4, $5, $6::jsonb)`,
            [section, amountValue, payment_method, `Credit Payment - Customer ${customerId}`, notes || null, JSON.stringify({ customer_id: customerId, bill_id: billId })]
        );

        await client.query('COMMIT');
        transactionStarted = false;
        res.status(201).json(paymentResult.rows[0]);
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Credit payment error:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

// Get all pending credits summary
const getPendingCredits = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.name, c.phone,
                   COALESCE(SUM(CASE WHEN cp.payment_type = 'credit' THEN cp.amount ELSE -cp.amount END), 0) as pending_balance
            FROM customers c
            INNER JOIN credit_payments cp ON c.id = cp.customer_id
            GROUP BY c.id
            HAVING COALESCE(SUM(CASE WHEN cp.payment_type = 'credit' THEN cp.amount ELSE -cp.amount END), 0) > 0
            ORDER BY pending_balance DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Get total pending amount
const getTotalPending = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COALESCE(SUM(CASE WHEN payment_type = 'credit' THEN amount ELSE -amount END), 0) as total_pending
            FROM credit_payments
        `);
        
        res.json({ total_pending: parseFloat(result.rows[0].total_pending) });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Get unpaid bills for a customer
const getCustomerUnpaidBills = async (req, res) => {
    try {
        const { customer_id } = req.params;
        const result = await pool.query(`
            SELECT id, bill_number, total_amount, amount_paid, balance_due, created_at
            FROM sales
            WHERE customer_id = $1 AND balance_due > 0 AND is_deleted = false
            ORDER BY created_at ASC
        `, [customer_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Get unpaid bills error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { getCustomerLedger, recordPayment, getPendingCredits, getTotalPending, getCustomerUnpaidBills };
