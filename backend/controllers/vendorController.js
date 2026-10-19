const { createHash, randomUUID } = require('crypto');
const pool = require('../config/database');
const A = require('../services/vendorAccounting');

// Use exact PostgreSQL numeric sums. paid_amount remains the original payment;
// later payments live in allocations, so the account never subtracts them twice.
const entriesSQL = `SELECT pe.*, p.name AS product_name, p.unit, v.name AS vendor_name,
    ROUND(pe.quantity * pe.purchase_price, 2) AS total,
    COALESCE(a.allocated, 0) AS allocated_amount,
    COALESCE(r.credit, 0) AS return_credit, COALESCE(r.quantity, 0) AS returned_quantity, COALESCE(r.returned_amount,0) AS returned_amount,
    GREATEST(ROUND(pe.quantity * pe.purchase_price, 2) - pe.paid_amount - COALESCE(a.allocated, 0) - COALESCE(r.credit, 0), 0) AS remaining_due
    FROM purchase_entries pe
    LEFT JOIN products p ON p.id=pe.product_id LEFT JOIN vendors v ON v.id=pe.vendor_id
    LEFT JOIN (SELECT purchase_entry_id, SUM(amount) allocated FROM vendor_payment_allocations GROUP BY purchase_entry_id) a ON a.purchase_entry_id=pe.id
    LEFT JOIN (SELECT purchase_entry_id, SUM(CASE WHEN settlement='credit' THEN amount ELSE 0 END) credit, SUM(quantity) quantity, SUM(amount) returned_amount FROM purchase_returns GROUP BY purchase_entry_id) r ON r.purchase_entry_id=pe.id`;
const vendorsSQL = `WITH purchases AS (
    SELECT vendor_id, COUNT(*) purchase_count, SUM(ROUND(quantity*purchase_price,2)) total_purchase,
    SUM(paid_amount) initial_paid, MAX(purchase_date) last_purchase,
    SUM(CASE WHEN purchase_date >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AND purchase_date < date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 month' THEN ROUND(quantity*purchase_price,2) ELSE 0 END) month_purchase
    FROM purchase_entries WHERE cancelled_at IS NULL GROUP BY vendor_id
), payments AS (SELECT vendor_id, SUM(amount) total_payment FROM vendor_payments GROUP BY vendor_id),
returns AS (SELECT vendor_id, SUM(CASE WHEN settlement='credit' THEN amount ELSE 0 END) credits, COUNT(*) FILTER (WHERE settlement='legacy') review_count FROM purchase_returns GROUP BY vendor_id),
dues AS (SELECT e.vendor_id, SUM(e.remaining_due) invoice_due,
    SUM(CASE WHEN e.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date THEN e.remaining_due ELSE 0 END) overdue
    FROM (${entriesSQL}) e WHERE e.cancelled_at IS NULL GROUP BY e.vendor_id)
SELECT v.*, COALESCE(p.purchase_count,0)::int purchase_count, COALESCE(p.total_purchase,0) total_purchase,
    COALESCE(p.initial_paid,0)+COALESCE(pay.total_payment,0) total_paid,
    COALESCE(r.credits,0) return_credit, COALESCE(r.review_count,0)::int review_count,
    COALESCE(p.month_purchase,0) month_purchase, p.last_purchase,
    v.opening_balance+COALESCE(p.total_purchase,0)-COALESCE(p.initial_paid,0)-COALESCE(pay.total_payment,0)-COALESCE(r.credits,0) balance,
    COALESCE(d.invoice_due,0) invoice_due, COALESCE(d.overdue,0) overdue
FROM vendors v LEFT JOIN purchases p ON p.vendor_id=v.id LEFT JOIN payments pay ON pay.vendor_id=v.id
LEFT JOIN returns r ON r.vendor_id=v.id LEFT JOIN dues d ON d.vendor_id=v.id`;

const makeController = (db) => {
    const wrap = fn => async (req, res) => {
        try { await fn(req, res); } catch (error) {
            if (!error.status) console.error('Vendor operation failed:', error.code || error.message);
            res.status(error.status || (error.code === '23505' ? 409 : 500)).json({ error: error.status ? error.message : error.code === '23505' ? 'This vendor or invoice already exists.' : 'Unable to complete this operation. Please retry.' });
        }
    };
    const transaction = async fn => {
        const client = await db.connect();
        try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const audit = (c, req, action, target, details) => c.query(
        'INSERT INTO audit_logs(user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
        [req.user.id, action, 'vendor', target, JSON.stringify(details)]);
    const vendor = async (c, vendorId, active = false) => {
        const result = await c.query('SELECT * FROM vendors WHERE id=$1 FOR UPDATE', [A.id(vendorId)]);
        if (!result.rows.length) A.fail('Vendor not found', 404);
        if (active && !result.rows[0].is_active) A.fail('Reactivate this vendor before recording a new purchase');
        return result.rows[0];
    };
    const once = (req, operation, fn) => transaction(async c => {
        const key = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
        if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) A.fail('A valid request key is required. Refresh and try again.');
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const hash = createHash('sha256').update(JSON.stringify({ body: req.body, params: req.params })).digest('hex');
        const existing = (await c.query('SELECT * FROM vendor_requests WHERE request_key=$1', [key])).rows[0];
        if (existing) {
            if (existing.user_id !== req.user.id || existing.operation !== operation || existing.payload_hash !== hash) A.fail('This request key was already used for a different operation', 409);
            return existing.response;
        }
        const result = await fn(c);
        await c.query('INSERT INTO vendor_requests(request_key,user_id,operation,payload_hash,response) VALUES($1,$2,$3,$4,$5)', [key, req.user.id, operation, hash, JSON.stringify(result)]);
        return result;
    });
    const book = (c, kind, amount, paymentMethod, reference, req, entryId = null) => amount > 0 && c.query(
        `INSERT INTO bank_cash_transactions(purchase_entry_id,section,transaction_type,amount,payment_method,reference,note,meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [entryId, paymentMethod === 'cash' ? 'cash' : 'bank', kind, amount, paymentMethod, reference, req.body.note || null, JSON.stringify({ vendor_id: req.body.vendor_id, accounting_version: 2 })]);
    const page = req => ({ limit: A.number(req.query.limit || 25,'Page size',{min:1,max:100,places:0}), page: A.number(req.query.page || 1,'Page',{min:1,max:1000000,places:0}) });
    const getVendors = wrap(async (req, res) => res.json((await db.query(`${vendorsSQL} ORDER BY v.name,v.id`)).rows));
    const getSummary = wrap(async (req, res) => {
        const rows = (await db.query(vendorsSQL)).rows;
        const sum = key => A.money(rows.reduce((n, row) => n + Number(row[key]), 0));
        res.json({ active: rows.filter(v => v.is_active).length, payable: A.money(rows.reduce((n,v) => n+Math.max(Number(v.balance),0),0)), advance: A.money(rows.reduce((n,v) => n+Math.max(-Number(v.balance),0),0)), month_purchase: sum('month_purchase'), review_count: sum('review_count') });
    });
    const list = kind => wrap(async (req, res) => {
        const paging = page(req), values = [], conditions = [];
        let sql;
        if (kind === 'purchases') sql = `SELECT e.* FROM (${entriesSQL}) e`;
        else if (kind === 'payments') sql = `SELECT e.*,v.name vendor_name,u.name user_name,COALESCE(a.allocated,0) allocated_amount FROM vendor_payments e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN (SELECT payment_id,SUM(amount) allocated FROM vendor_payment_allocations GROUP BY payment_id) a ON a.payment_id=e.id`;
        else sql = `SELECT e.*,v.name vendor_name,p.name product_name,p.unit,pe.invoice_no FROM purchase_returns e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN products p ON p.id=e.product_id LEFT JOIN purchase_entries pe ON pe.id=e.purchase_entry_id`;
        if (req.query.vendor_id) { values.push(A.id(req.query.vendor_id)); conditions.push(`e.vendor_id=$${values.length}`); }
        if (kind === 'purchases' && req.query.open === 'true') conditions.push('e.cancelled_at IS NULL AND e.remaining_due>0');
        const dateColumn = kind === 'purchases' ? 'e.purchase_date' : kind === 'payments' ? 'COALESCE(e.payment_date::timestamp,e.created_at)' : 'e.created_at';
        if (req.query.from) { values.push(A.date(req.query.from, 'From date')); conditions.push(`${dateColumn} >= $${values.length}::date`); }
        if (req.query.to) { values.push(A.date(req.query.to, 'To date')); conditions.push(`${dateColumn} < $${values.length}::date + INTERVAL '1 day'`); }
        if (req.query.from && req.query.to && req.query.from > req.query.to) A.fail('From date must not follow To date');
        if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
        // Search outside the projection so joined display names can be searched safely.
        if (req.query.search) { values.push(`%${String(req.query.search).slice(0,150)}%`); sql = `SELECT * FROM (${sql}) searched WHERE concat_ws(' ',vendor_name,${kind === 'payments' ? 'reference,method' : 'product_name,invoice_no'}) ILIKE $${values.length}`; }
        const total = Number((await db.query(`SELECT COUNT(*) FROM (${sql}) counted`, values)).rows[0].count);
        const result = await db.query(`${sql} ORDER BY ${kind === 'purchases' ? 'purchase_date' : 'created_at'} DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values, req.query.page ? paging.limit : 500, req.query.page ? (paging.page-1)*paging.limit : 0]);
        res.json(req.query.page ? { items: result.rows, total, ...paging } : result.rows);
    });
    const getLedger = wrap(async (req, res) => {
        const vendorId = A.id(req.params.id);
        const record = (await db.query(`${vendorsSQL} WHERE v.id=$1`, [vendorId])).rows[0];
        if (!record) A.fail('Vendor not found', 404);
        const result = await db.query(`SELECT * FROM (
            SELECT 'purchase' type, id, purchase_date date, COALESCE(invoice_no,'PUR-'||id) reference, note,
                CASE WHEN cancelled_at IS NULL THEN ROUND(quantity*purchase_price,2) ELSE 0 END debit,
                CASE WHEN cancelled_at IS NULL THEN paid_amount ELSE 0 END credit,
                cancelled_at IS NOT NULL cancelled FROM purchase_entries WHERE vendor_id=$1
            UNION ALL SELECT 'payment',id,COALESCE(payment_date::timestamp,created_at),COALESCE(reference,'PAY-'||id),note,0,amount,false FROM vendor_payments WHERE vendor_id=$1
            UNION ALL SELECT 'return',id,created_at,'RET-'||id,concat_ws(' · ',note,CASE WHEN settlement='legacy' THEN 'Needs review: refund or credit unknown' WHEN settlement='refund' THEN 'Refund received; no net payable change' ELSE 'Vendor credit' END),0,CASE WHEN settlement='credit' THEN amount ELSE 0 END,false FROM purchase_returns WHERE vendor_id=$1
        ) ledger ORDER BY date,type,id`, [vendorId]);
        let balance = A.cents(record.opening_balance);
        const rows = result.rows.map(row => { balance += A.cents(row.debit)-A.cents(row.credit); return { ...row, balance: balance/100 }; });
        res.json({ vendor: record, entries: rows });
    });
    const saveVendor = wrap(async (req, res) => {
        const b=req.body, name=A.text(b.name,'Vendor name',150,true), phone=A.text(b.phone,'Phone',30), email=A.text(b.email,'Email',200), gst=A.text(b.gst_number,'GSTIN',30);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) A.fail('Enter a valid email address');
        if (phone && !/^[+\d\s()-]{7,30}$/.test(phone)) A.fail('Enter a valid phone number');
        if (gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst.toUpperCase())) A.fail('Enter a valid 15-character GSTIN');
        const opening=A.number(b.opening_balance ?? 0,'Opening balance'), terms=A.number(b.payment_terms ?? 0,'Payment terms',{max:365,places:0});
        const result = await transaction(async c => {
            let old;
            if (req.params.id) {
                old = await vendor(c,req.params.id);
                if (A.cents(old.opening_balance)!==A.cents(opening)) A.fail('Opening balance is locked after creation. Use a reviewed accounting adjustment instead.');
            }
            const args=[name,phone,A.text(b.address,'Address',2000),gst?.toUpperCase()||null,opening,A.text(b.contact_person,'Contact person',150),email,terms,A.text(b.notes,'Notes',2000)];
            const result=old ? await c.query('UPDATE vendors SET name=$1,phone=$2,address=$3,gst_number=$4,opening_balance=$5,contact_person=$6,email=$7,payment_terms=$8,notes=$9,updated_at=NOW() WHERE id=$10 RETURNING *',[...args,old.id]) : await c.query('INSERT INTO vendors(name,phone,address,gst_number,opening_balance,contact_person,email,payment_terms,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',args);
            await audit(c,req,old?'vendor_updated':'vendor_created',result.rows[0].id,{before:old,after:result.rows[0]});
            return result.rows[0];
        });
        res.status(req.params.id?200:201).json(result);
    });
    const setActive = wrap(async (req,res) => {
        const active=req.method==='DELETE'?false:req.body.is_active;
        if (typeof active!=='boolean') A.fail('Choose an active status');
        res.json(await transaction(async c=>{ const old=await vendor(c,req.params.id); const result=await c.query('UPDATE vendors SET is_active=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[active,old.id]); await audit(c,req,active?'vendor_reactivated':'vendor_deactivated',old.id,{is_active:active}); return result.rows[0]; }));
    });
    const createPurchase = wrap(async (req,res) => {
        const b=req.body, vendorId=A.id(b.vendor_id), invoiceNo=A.text(b.invoice_no,'Invoice number',80,true), purchaseDate=A.date(b.purchase_date,'Purchase date'), dueDate=A.date(b.due_date,'Due date',true), paymentMethod=A.method(b.payment_method||'bank');
        if (dueDate && dueDate<purchaseDate) A.fail('Due date cannot precede the invoice date');
        const items=b.items || [b];
        if (!Array.isArray(items)||!items.length||items.length>100) A.fail('Add between 1 and 100 products');
        const lines=items.map(item=>({product_id:A.id(item.product_id),quantity:A.number(item.quantity,'Quantity',{min:0.001,places:3}),price:A.number(item.purchase_price,'Unit price'),source:item.source||b.source||'bank'}));
        if(lines.some(l=>!['cash','bank'].includes(l.source))) A.fail('Choose a valid stock category');
        for(const l of lines) l.total=A.number(A.lineTotal(l.quantity,l.price),'Line total');
        const total=A.money(lines.reduce((n,l)=>n+l.total,0)), paid=A.number(b.paid_amount??0,'Paid amount');
        A.number(total,'Invoice total');
        if(paid>total) A.fail('Paid amount exceeds invoice total. Record excess separately as a vendor advance.');
        res.status(201).json(await once(req,'purchase',async c=>{
            const v=await vendor(c,vendorId,true);
            const duplicate=await c.query('SELECT id FROM purchase_entries WHERE vendor_id=$1 AND lower(trim(invoice_no))=lower($2) AND cancelled_at IS NULL',[vendorId,invoiceNo]);
            if(duplicate.rows.length) A.fail('An active invoice with this number already exists for this vendor',409);
            const productIds=[...new Set(lines.map(l=>l.product_id))].sort((a,b)=>a-b);
            const products=await c.query('SELECT * FROM products WHERE id=ANY($1::int[]) AND is_active=true ORDER BY id FOR UPDATE',[productIds]);
            if(products.rows.length!==productIds.length) A.fail('One or more products are unavailable');
            const productsMap=new Map(products.rows.map(p=>[p.id,p])), key=randomUUID(), saved=[];
            let remaining=A.cents(paid);
            for(const l of lines){
                const p=productsMap.get(l.product_id), linePaid=Math.min(remaining,A.cents(l.total))/100; remaining-=A.cents(linePaid);
                const effectiveDue=dueDate||new Date(Date.parse(purchaseDate)+v.payment_terms*86400000).toISOString().slice(0,10);
                const result=await c.query(`INSERT INTO purchase_entries(product_id,vendor_id,source,invoice_no,purchase_date,quantity,purchase_price,payment_status,paid_amount,due_amount,note,user_id,invoice_key,due_date,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[p.id,vendorId,l.source,invoiceNo,purchaseDate,l.quantity,l.price,A.status(l.total,linePaid),linePaid,A.money(l.total-linePaid),A.text(b.note,'Note',2000),req.user.id,key,effectiveDue,paymentMethod]);
                const previous=Number(p.stock), next=Number(p[l.source+'_stock'])+l.quantity;
                p[l.source+'_stock']=Number(next.toFixed(3)); p.stock=Number((Number(p.bank_stock)+Number(p.cash_stock)).toFixed(3));
                await c.query('UPDATE products SET bank_stock=$1,cash_stock=$2,stock=$3,purchase_price=$4,updated_at=NOW() WHERE id=$5',[p.bank_stock,p.cash_stock,p.stock,l.price,p.id]);
                await c.query(`INSERT INTO inventory_logs(product_id,change_type,quantity_change,previous_stock,new_stock,notes,user_id) VALUES($1,'purchase',$2,$3,$4,$5,$6)`,[p.id,l.quantity,previous,p.stock,`Invoice ${invoiceNo}`,req.user.id]);
                await book(c,'purchase',linePaid,paymentMethod,invoiceNo,req,result.rows[0].id);
                saved.push(result.rows[0]);
            }
            await audit(c,req,'vendor_purchase_posted',vendorId,{invoice_key:key,invoice_no:invoiceNo,total,paid,entry_ids:saved.map(e=>e.id)});
            return {invoice_key:key,total,paid,entries:saved};
        }));
    });
    const createPayment = wrap(async(req,res)=>{
        const b=req.body, vendorId=A.id(b.vendor_id), amount=A.number(b.amount,'Amount',{min:0.01}), paymentMethod=A.method(b.method), paymentDate=A.date(b.payment_date,'Payment date');
        if(!['auto','selected','account'].includes(b.allocation)) A.fail('Choose a payment allocation method');
        if(b.allocation==='selected') A.id(b.purchase_entry_id);
        res.status(201).json(await once(req,'payment',async c=>{
            await vendor(c,vendorId);
            const result=await c.query('INSERT INTO vendor_payments(vendor_id,amount,method,reference,note,user_id,payment_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[vendorId,amount,paymentMethod,A.text(b.reference,'Reference',200),A.text(b.note,'Note',2000),req.user.id,paymentDate]);
            const payment=result.rows[0]; let remaining=A.cents(amount), allocations=[];
            if(b.allocation!=='account'){
                let rows=(await c.query(`${entriesSQL} WHERE pe.vendor_id=$1 AND pe.cancelled_at IS NULL ORDER BY pe.purchase_date,pe.id`,[vendorId])).rows;
                if(b.allocation==='selected'){const chosen=A.id(b.purchase_entry_id);rows=rows.filter(e=>e.id===chosen&&Number(e.remaining_due)>0);if(!rows.length) A.fail('Selected purchase has no outstanding balance or belongs to another vendor');}
                for(const row of rows){
                    const applied=Math.min(remaining,A.cents(row.remaining_due)); if(applied<=0) continue;
                    if(paymentDate<String(row.purchase_date instanceof Date?row.purchase_date.toISOString().slice(0,10):row.purchase_date).slice(0,10)) A.fail('Payment date cannot precede an allocated purchase date');
                    await c.query('INSERT INTO vendor_payment_allocations(payment_id,purchase_entry_id,amount) VALUES($1,$2,$3)',[payment.id,row.id,applied/100]); remaining-=applied; allocations.push({purchase_entry_id:row.id,amount:applied/100});
                }
            }
            await book(c,'vendor_payment',amount,paymentMethod,`PAY-${payment.id}`,req);
            await audit(c,req,'vendor_payment_recorded',vendorId,{payment_id:payment.id,amount,allocations,unallocated:remaining/100});
            return {...payment,allocations,unallocated:remaining/100};
        }));
    });
    const allocatePayment = wrap(async(req,res)=>{
        const paymentId=A.id(req.params.id);
        if(!['auto','selected'].includes(req.body.allocation)) A.fail('Choose oldest unpaid items or a selected item');
        res.json(await once(req,'allocate',async c=>{
            const payment=(await c.query('SELECT * FROM vendor_payments WHERE id=$1',[paymentId])).rows[0];
            if(!payment) A.fail('Payment not found',404);
            await vendor(c,payment.vendor_id);
            const allocated=Number((await c.query('SELECT COALESCE(SUM(amount),0) amount FROM vendor_payment_allocations WHERE payment_id=$1',[paymentId])).rows[0].amount);
            let remaining=A.cents(payment.amount)-A.cents(allocated);const before=remaining;
            if(remaining<=0) A.fail('This payment has no unallocated credit');
            let rows=(await c.query(`${entriesSQL} WHERE pe.vendor_id=$1 AND pe.cancelled_at IS NULL ORDER BY pe.purchase_date,pe.id`,[payment.vendor_id])).rows;
            if(req.body.allocation==='selected') {const chosen=A.id(req.body.purchase_entry_id);rows=rows.filter(e=>e.id===chosen);}
            for(const row of rows){const amount=Math.min(remaining,A.cents(row.remaining_due));if(amount<=0)continue;
                await c.query(`INSERT INTO vendor_payment_allocations(payment_id,purchase_entry_id,amount) VALUES($1,$2,$3) ON CONFLICT(payment_id,purchase_entry_id) DO UPDATE SET amount=vendor_payment_allocations.amount+EXCLUDED.amount`,[paymentId,row.id,amount/100]);remaining-=amount;
            }
            if(remaining===before) A.fail('No unpaid purchase items are available for this vendor');
            await audit(c,req,'vendor_credit_allocated',payment.vendor_id,{payment_id:paymentId,allocated:(before-remaining)/100});
            return {allocated:(before-remaining)/100,unallocated:remaining/100};
        }));
    });
    const createReturn = wrap(async(req,res)=>{
        const b=req.body, entryId=A.id(b.purchase_entry_id), qty=A.number(b.quantity,'Return quantity',{min:0.001,places:3}), note=A.text(b.note,'Return reason',2000,true);
        if(!['credit','refund'].includes(b.settlement)) A.fail('Choose vendor credit or refund received');
        if(b.settlement==='refund') A.method(b.refund_method);
        res.status(201).json(await once(req,'return',async c=>{
            const original=(await c.query('SELECT vendor_id FROM purchase_entries WHERE id=$1',[entryId])).rows[0];if(!original) A.fail('Purchase not found',404);
            if(A.id(b.vendor_id)!==original.vendor_id) A.fail('Selected purchase does not belong to this vendor');
            await vendor(c,original.vendor_id);
            const entry=(await c.query(`${entriesSQL} WHERE pe.id=$1`,[entryId])).rows[0];
            if(entry.cancelled_at) A.fail('Cannot return a cancelled purchase');
            if(Math.round(qty*1000)>Math.round((Number(entry.quantity)-Number(entry.returned_quantity))*1000)) A.fail('Return quantity exceeds the unreturned quantity on this purchase');
            const amount=A.money(A.lineTotal(Number(entry.returned_quantity)+qty,entry.purchase_price)-Number(entry.returned_amount));
            if(b.settlement==='refund' && Number(entry.remaining_due)>0) A.fail('Settle this purchase first, or choose vendor credit');
            const p=(await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[entry.product_id])).rows[0];
            if(!p||Number(p[entry.source+'_stock'])<qty) A.fail('Not enough stock in the original stock category');
            const previous=Number(p.stock);p[entry.source+'_stock']=Number((Number(p[entry.source+'_stock'])-qty).toFixed(3));p.stock=Number((Number(p.bank_stock)+Number(p.cash_stock)).toFixed(3));
            const result=await c.query(`INSERT INTO purchase_returns(vendor_id,product_id,source,quantity,unit_price,amount,note,user_id,purchase_entry_id,settlement,refund_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[entry.vendor_id,p.id,entry.source,qty,entry.purchase_price,amount,note,req.user.id,entry.id,b.settlement,b.settlement==='refund'?b.refund_method:null]);
            await c.query('UPDATE products SET bank_stock=$1,cash_stock=$2,stock=$3,updated_at=NOW() WHERE id=$4',[p.bank_stock,p.cash_stock,p.stock,p.id]);
            await c.query(`INSERT INTO inventory_logs(product_id,change_type,quantity_change,previous_stock,new_stock,notes,user_id) VALUES($1,'return',$2,$3,$4,$5,$6)`,[p.id,-qty,previous,p.stock,note,req.user.id]);
            if(b.settlement==='refund') await book(c,'purchase_return',amount,b.refund_method,`RET-${result.rows[0].id}`,{...req,body:{...b,vendor_id:entry.vendor_id}});
            await audit(c,req,'vendor_purchase_returned',entry.vendor_id,result.rows[0]);return result.rows[0];
        }));
    });
    const cancelPurchase = wrap(async(req,res)=>{
        const entryId=A.id(req.params.id), reason=A.text(req.body.reason,'Cancellation reason',2000,true);
        res.json(await once(req,'cancel',async c=>{
            const original=(await c.query('SELECT vendor_id FROM purchase_entries WHERE id=$1',[entryId])).rows[0];if(!original) A.fail('Purchase not found',404);
            await vendor(c,original.vendor_id);
            const e=(await c.query(`${entriesSQL} WHERE pe.id=$1`,[entryId])).rows[0];
            if(e.cancelled_at) A.fail('This purchase is already cancelled',409);
            if(Number(e.paid_amount)>0||Number(e.allocated_amount)>0||Number(e.returned_quantity)>0) A.fail('Purchases with payments or returns cannot be cancelled. Use a linked return to preserve the history.');
            const p=(await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[e.product_id])).rows[0];
            if(!p||Number(p[e.source+'_stock'])<Number(e.quantity)) A.fail('Purchased stock has been used; cancellation would make stock negative');
            const previous=Number(p.stock);p[e.source+'_stock']=Number((Number(p[e.source+'_stock'])-Number(e.quantity)).toFixed(3));p.stock=Number((Number(p.bank_stock)+Number(p.cash_stock)).toFixed(3));
            await c.query('UPDATE products SET bank_stock=$1,cash_stock=$2,stock=$3,updated_at=NOW() WHERE id=$4',[p.bank_stock,p.cash_stock,p.stock,p.id]);
            await c.query(`INSERT INTO inventory_logs(product_id,change_type,quantity_change,previous_stock,new_stock,notes,user_id) VALUES($1,'adjustment',$2,$3,$4,$5,$6)`,[p.id,-Number(e.quantity),previous,p.stock,`Purchase ${e.id} cancelled: ${reason}`,req.user.id]);
            await c.query('UPDATE purchase_entries SET cancelled_at=NOW(),cancellation_reason=$1 WHERE id=$2',[reason,e.id]);
            await c.query(`UPDATE bank_cash_transactions SET meta=COALESCE(meta,'{}'::jsonb)||'{"voided":true}'::jsonb WHERE purchase_entry_id=$1`,[e.id]);
            await audit(c,req,'vendor_purchase_cancelled',e.vendor_id,{entry_id:e.id,reason});return {message:'Purchase cancelled; history retained'};
        }));
    });
    return { getVendors,getSummary,getLedger,saveVendor,setActive,createPurchase,createPayment,allocatePayment,createReturn,cancelPurchase,getPurchases:list('purchases'),getPayments:list('payments'),getReturns:list('returns') };
};
module.exports = { ...makeController(pool), makeController };
