const pool = require('../config/database');

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

const processSale = async (data, userId, role = 'cashier') => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            customer_id,
            items,
            payment_method,
            payment_status,
            payment_breakdown,
            amount_paid,
            balance_due,
            cash_received,
            change_return,
            discount = 0,
            notes
        } = data;

        if (!items || !items.length) throw new Error('No items in cart');
        if (!['cash', 'upi', 'udhar', 'split'].includes(payment_method)) throw new Error('Invalid payment method');

        let subtotal = 0;
        const preparedItems = [];
        
        // 1. Validate & Lock Items
        for (const item of items) {
            const requestedQuantity = Number(item.quantity);
            const quantity = Number(requestedQuantity.toFixed(3));
            const stockSource = item.stock_source === 'cash' ? 'cash' : 'bank';

            if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || Math.abs(requestedQuantity - quantity) > 0.0000001) {
                throw new Error('Quantity must be positive and use no more than 3 decimal places');
            }

            const productResult = await client.query(
                'SELECT id, name, stock, unit, bank_stock, cash_stock, selling_price FROM products WHERE id = $1 AND is_active = true FOR UPDATE',
                [item.product_id]
            );

            if (!productResult.rows.length) throw new Error(`Product not found: ${item.product_id}`);

            const product = productResult.rows[0];
            const price = Number(role === 'cashier' ? product.selling_price : item.price);
            if (!Number.isFinite(price) || price < 0) throw new Error('Invalid price in cart');
            const available = Number(stockSource === 'cash' ? product.cash_stock : product.bank_stock);
            if (available < quantity) throw new Error(`Not enough ${stockSource} stock for ${product.name}`);

            const lineTotal = roundMoney(price * quantity);
            subtotal += lineTotal;
            preparedItems.push({ ...item, quantity, price: roundMoney(price), stock_source: stockSource, product, lineTotal });
        }

        // 2. Calculate Totals
        subtotal = roundMoney(subtotal);
        const discountValue = roundMoney(role === 'cashier' ? 0 : discount);
        const totalAmount = roundMoney(Math.max(subtotal - discountValue, 0));
        const breakdown = buildPaymentBreakdown(payment_method, payment_breakdown, totalAmount);
        if (role === 'cashier') {
            const values = [breakdown.cash, breakdown.upi, breakdown.credit];
            if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid payment split');
            const splitTotal = roundMoney(values.reduce((sum, value) => sum + value, 0));
            if (Math.abs(splitTotal - totalAmount) > 0.01) throw new Error('Payment split must match the bill total');
        }

        const derivedAmountPaid = role === 'cashier'
            ? roundMoney(breakdown.cash + breakdown.upi)
            : (amount_paid !== undefined ? roundMoney(amount_paid) : roundMoney(Math.max(totalAmount - roundMoney(balance_due), 0)));
        const derivedBalanceDue = role === 'cashier'
            ? roundMoney(Math.max(totalAmount - derivedAmountPaid, 0))
            : (balance_due !== undefined ? roundMoney(balance_due) : roundMoney(Math.max(totalAmount - derivedAmountPaid, 0)));
        const cashierCashReceived = Number(cash_received ?? breakdown.cash);
        if (role === 'cashier' && (!Number.isFinite(cashierCashReceived) || cashierCashReceived < breakdown.cash)) throw new Error('Cash received cannot be less than the cash payment');
        const derivedCashReceived = role === 'cashier'
            ? roundMoney(cashierCashReceived)
            : (cash_received !== undefined ? roundMoney(cash_received) : roundMoney(breakdown.cash));
        const derivedChangeReturn = role === 'cashier'
            ? (payment_method === 'cash' ? roundMoney(Math.max(cashierCashReceived - totalAmount, 0)) : 0)
            : (change_return !== undefined ? roundMoney(change_return) : 0);
        const finalPaymentStatus = role === 'cashier'
            ? (derivedBalanceDue > 0 ? (derivedAmountPaid > 0 ? 'partial' : 'pending') : 'paid')
            : (payment_status || (derivedBalanceDue > 0 ? (derivedAmountPaid > 0 ? 'partial' : 'pending') : 'paid'));

        // 3. Generate Bill Number
        // Keep the legacy format while preventing simultaneous checkouts from
        // selecting the same next number.
        await client.query('SELECT pg_advisory_xact_lock(20261012, 1)');
        const billResult = await client.query("SELECT COALESCE(MAX(CAST(SUBSTRING(bill_number FROM 5) AS INTEGER)), 0) + 1 as next_num FROM sales");
        const billNumber = `BILL${String(billResult.rows[0].next_num).padStart(6, '0')}`;

        // 4. Create Sale Record
        const saleResult = await client.query(
            `INSERT INTO sales (
                bill_number, customer_id, user_id, subtotal, discount, total_amount,
                payment_method, payment_status, payment_breakdown, amount_paid,
                balance_due, cash_received, change_return, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING *`,
            [billNumber, customer_id || null, userId, subtotal, discountValue, totalAmount, payment_method, finalPaymentStatus, JSON.stringify(breakdown), derivedAmountPaid, derivedBalanceDue, derivedCashReceived, derivedChangeReturn, notes || null]
        );

        const sale = saleResult.rows[0];
        const sourceTotals = { bank: 0, cash: 0 };

        // 5. Process Items & Update Stock
        for (const item of preparedItems) {
            const previousStock = Number(item.product.stock || 0);
            const previousBank = Number(item.product.bank_stock || 0);
            const previousCash = Number(item.product.cash_stock || 0);
            const nextBank = item.stock_source === 'bank' ? previousBank - item.quantity : previousBank;
            const nextCash = item.stock_source === 'cash' ? previousCash - item.quantity : previousCash;
            const nextStock = nextBank + nextCash;

            // Link Sale Item
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, price, total, stock_source)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [sale.id, item.product_id, item.quantity, item.price, item.lineTotal, item.stock_source]
            );

            // Update Product Stock
            await client.query(
                'UPDATE products SET stock = $1, bank_stock = $2, cash_stock = $3, updated_at = NOW() WHERE id = $4',
                [nextStock, nextBank, nextCash, item.product_id]
            );

            // Log Inventory
            await client.query(
                `INSERT INTO inventory_logs (product_id, change_type, quantity_change, previous_stock, new_stock, notes, user_id)
                 VALUES ($1, 'sale', $2, $3, $4, $5, $6)`,
                [item.product_id, -item.quantity, previousStock, nextStock, `${item.stock_source} stock sale${item.manual_price ? ' with manual price override' : ''}`, userId]
            );

            sourceTotals[item.stock_source] += item.lineTotal;
        }

        // 6. Record Credit Payment (if any)
        if (customer_id && breakdown.credit > 0) {
            await client.query(
                `INSERT INTO credit_payments (customer_id, sale_id, amount, payment_type, notes)
                 VALUES ($1, $2, $3, 'credit', $4)`,
                [customer_id, sale.id, roundMoney(breakdown.credit), notes || 'Billing pending amount']
            );
        }

        // 7. Record Cash/Bank Transactions
        if (sourceTotals.bank > 0) {
            await client.query(
                `INSERT INTO bank_cash_transactions (sale_id, section, transaction_type, amount, payment_method, reference, note, meta)
                 VALUES ($1, 'bank', 'sale', $2, $3, $4, $5, $6::jsonb)`,
                [sale.id, roundMoney(sourceTotals.bank), payment_method, billNumber, notes || null, JSON.stringify({ source: 'bank_stock' })]
            );
        }
        if (sourceTotals.cash > 0) {
            await client.query(
                `INSERT INTO bank_cash_transactions (sale_id, section, transaction_type, amount, payment_method, reference, note, meta)
                 VALUES ($1, 'cash', 'sale', $2, $3, $4, $5, $6::jsonb)`,
                [sale.id, roundMoney(sourceTotals.cash), payment_method, billNumber, notes || null, JSON.stringify({ source: 'cash_stock' })]
            );
        }

        // 8. Handle UPI Trace for Cash Stock Sales (Business Rule)
        const cashShare = totalAmount > 0 ? sourceTotals.cash / totalAmount : 0;
        const upiTraceAmount = roundMoney((breakdown.upi || 0) * cashShare);
        if (sourceTotals.cash > 0 && upiTraceAmount > 0) {
            await client.query(
                `INSERT INTO bank_cash_transactions (sale_id, section, transaction_type, amount, payment_method, reference, note, meta)
                 VALUES ($1, 'bank', 'upi_trace', $2, 'upi', $3, $4, $5::jsonb)`,
                [sale.id, upiTraceAmount, billNumber, 'UPI trace for cash stock sale', JSON.stringify({ mirrored_from: 'cash', stock_source: 'cash', payment_method })]
            );
        }

        await client.query('COMMIT');
        return sale;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { processSale };
