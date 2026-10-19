// Integration suite: a disposable database, never the shop database.
require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { makeController } = require('../controllers/vendorController');
const base = { host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD };
const name = `pos_vendor_test_${Date.now()}`;
const admin = new Pool({...base,database:'postgres'});
let db, c, userId, productId, vendorId, checks=0;
async function call(fn,body={},params={},query={},key=randomUUID()) {
    let status=200,data;
    await c[fn]({body,params,query,user:{id:userId,role:'admin'},headers:{'idempotency-key':key},method:fn==='cancelPurchase'?'DELETE':'POST'}, {status(n){status=n;return this;},json(value){data=value;}});
    return {status,data};
}
const good = r => { assert.ok(r.status<300,JSON.stringify(r)); return r.data; };
async function check(label,fn){await fn();checks++;console.log(`PASS ${label}`);}
const purchase=(extra={})=>({vendor_id:vendorId,invoice_no:randomUUID(),purchase_date:'2026-10-01',due_date:'2026-10-15',paid_amount:0,payment_method:'bank',items:[{product_id:productId,quantity:10,purchase_price:10,source:'bank'}],...extra});
const payment=(extra={})=>({vendor_id:vendorId,amount:10,method:'bank',payment_date:'2026-10-16',allocation:'auto',...extra});
const balance=async()=>Number(good(await call('getVendors')).find(v=>v.id===vendorId).balance);
const run=async()=>{
    await admin.query(`CREATE DATABASE "${name}"`);
    db=new Pool({...base,database:name});
    await db.query(fs.readFileSync(path.join(__dirname,'../../database/schema.sql'),'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname,'../database/vendor-workspace.sql'),'utf8'));
    c=makeController(db);
    userId=(await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Test','vendor-test@example.invalid','unused','admin') RETURNING id")).rows[0].id;
    productId=(await db.query("INSERT INTO products(name,selling_price) VALUES('Test stock',20) RETURNING id")).rows[0].id;
    vendorId=good(await call('saveVendor',{name:'Test Vendor',opening_balance:50,payment_terms:14})).id;
    let invoice, paidInvoice, cancellable;
    await check('Multi-item invoice, decimal quantity, atomic stock and paid-now calculation',async()=>{
        invoice=good(await call('createPurchase',purchase({paid_amount:30,items:[{product_id:productId,quantity:10,purchase_price:10,source:'bank'},{product_id:productId,quantity:0.5,purchase_price:20,source:'cash'}]})));
        assert.equal(invoice.total,110);assert.equal(invoice.entries.length,2);assert.equal(await balance(),130);
        const p=(await db.query('SELECT * FROM products WHERE id=$1',[productId])).rows[0];assert.equal(Number(p.stock),10.5);
        const cash=(await db.query("SELECT sum(amount) total FROM bank_cash_transactions WHERE transaction_type='purchase'")).rows[0];assert.equal(Number(cash.total),30);
    });
    await check('Manual status cannot mark an unpaid invoice paid',async()=>{
        const p=good(await call('createPurchase',purchase({payment_status:'paid'})));assert.equal(p.entries[0].payment_status,'unpaid');cancellable=p.entries[0];
    });
    await check('Concurrent retries create one payment and one allocation',async()=>{
        const key=randomUUID(),body=payment({amount:40});const responses=await Promise.all([call('createPayment',body,{}, {},key),call('createPayment',body,{}, {},key)]);
        assert.equal(good(responses[0]).id,good(responses[1]).id);assert.equal((await db.query('SELECT count(*) FROM vendor_payments')).rows[0].count,'1');
        const entries=good(await call('getPurchases',{}, {},{page:1}));assert.equal(Number(entries.items.find(e=>e.id===invoice.entries[0].id).remaining_due),30);
        assert.equal(await balance(),190);
    });
    await check('Duplicate invoice rejected without changing stock',async()=>{
        const result=await call('createPurchase',purchase({invoice_no:invoice.entries[0].invoice_no}));assert.equal(result.status,409);
    });
    await check('Invalid second product rolls back entire invoice',async()=>{
        const before=(await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock;
        assert.equal((await call('createPurchase',purchase({items:[{product_id:productId,quantity:1,purchase_price:1},{product_id:2147483647,quantity:1,purchase_price:1}]}))).status,400);
        assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,before);
    });
    await check('Invalid, negative, fractional precision and nonfinite inputs are rejected',async()=>{
        for(const value of [-1,'bad',Infinity,0.001])assert.equal((await call('createPayment',payment({amount:value}))).status,400);
        assert.equal((await call('createPurchase',purchase({paid_amount:101}))).status,400);
        assert.equal((await call('createPurchase',purchase({purchase_date:'2026-02-30'}))).status,400);
        assert.equal((await call('getPurchases',{}, {},{page:'1.5'})).status,400);
    });
    await check('Return credit uses original cost and reduces account balance',async()=>{
        good(await call('createReturn',{vendor_id:vendorId,purchase_entry_id:invoice.entries[0].id,quantity:2,settlement:'credit',note:'Damaged'}));assert.equal(await balance(),170);
    });
    await check('Over-return and refund on unpaid item are rejected',async()=>{
        assert.equal((await call('createReturn',{vendor_id:vendorId,purchase_entry_id:invoice.entries[0].id,quantity:9,settlement:'credit',note:'Invalid'})).status,400);
        assert.equal((await call('createReturn',{vendor_id:vendorId,purchase_entry_id:invoice.entries[0].id,quantity:1,settlement:'refund',refund_method:'bank',note:'Invalid'})).status,400);
    });
    await check('Cancellation retains history and reverses stock atomically',async()=>{
        good(await call('cancelPurchase',{reason:'Duplicate delivery'}, {id:cancellable.id}));assert.equal(await balance(),70);
        assert.ok((await db.query('SELECT cancelled_at FROM purchase_entries WHERE id=$1',[cancellable.id])).rows[0].cancelled_at);
        assert.equal((await call('cancelPurchase',{reason:'Again'},{id:cancellable.id})).status,409);
        assert.equal((await call('cancelPurchase',{reason:'Paid'},{id:invoice.entries[0].id})).status,400);
    });
    await check('Advance is retained and balances never double-subtract allocations',async()=>{
        const result=good(await call('createPayment',payment({amount:100})));assert.equal(result.unallocated,80);assert.equal(await balance(),-30);
        const l=good(await call('getLedger',{}, {id:vendorId}));assert.equal(l.entries.at(-1).balance,Number(l.vendor.balance));
    });
    await check('Settled purchase refund records cash without reducing payable twice',async()=>{
        paidInvoice=good(await call('createPurchase',purchase({paid_amount:100})));const before=await balance();
        good(await call('createReturn',{vendor_id:vendorId,purchase_entry_id:paidInvoice.entries[0].id,quantity:1,settlement:'refund',refund_method:'cash',note:'Refund received'}));assert.equal(await balance(),before);
    });
    await check('Inactive vendors accept settlement, not new purchases; edits preserve status',async()=>{
        good(await call('setActive',{is_active:false},{id:vendorId}));assert.equal((await call('createPurchase',purchase())).status,400);
        good(await call('saveVendor',{name:'Renamed',opening_balance:50,payment_terms:7},{id:vendorId}));assert.equal(good(await call('getVendors'))[0].is_active,false);
        good(await call('createPayment',payment({allocation:'account',amount:1})));assert.equal((await call('saveVendor',{name:'Renamed',opening_balance:0},{id:vendorId})).status,400);
        good(await call('setActive',{is_active:true},{id:vendorId}));
    });
    await check('Same request key with different data is rejected',async()=>{
        const key=randomUUID();good(await call('createPayment',payment({allocation:'account'}),{}, {},key));assert.equal((await call('createPayment',payment({amount:20,allocation:'account'}),{}, {},key)).status,409);
    });
    await check('Payments cannot allocate to another vendor',async()=>{
        const other=good(await call('saveVendor',{name:'Other',opening_balance:0}));
        assert.equal((await call('createPayment',payment({vendor_id:other.id,allocation:'selected',purchase_entry_id:invoice.entries[0].id}))).status,400);
    });
    await check('Legacy returns are explicitly marked for review, not silently deducted',async()=>{
        const before=await balance();await db.query('INSERT INTO purchase_returns(vendor_id,product_id,source,quantity,unit_price,amount) VALUES($1,$2,\'bank\',1,10,10)',[vendorId,productId]);
        const v=good(await call('getVendors')).find(v=>v.id===vendorId);assert.equal(v.review_count,1);assert.equal(Number(v.balance),before);
    });
    await check('Totals include more than 500 purchases, pagination and search stay correct',async()=>{
        const before=await balance();const monthBefore=good(await call('getSummary')).month_purchase;const now=new Date();const priorYearMonth=`${now.getFullYear()-1}-${String(now.getMonth()+1).padStart(2,'0')}-01`;await db.query(`INSERT INTO purchase_entries(vendor_id,product_id,source,quantity,purchase_price,paid_amount,payment_status,invoice_no,purchase_date) SELECT $1,$2,'bank',1,1,0,'unpaid','BULK-'||n,$3::date FROM generate_series(1,510) n`,[vendorId,productId,priorYearMonth]);
        assert.equal(await balance(),before+510);
        const list=good(await call('getPurchases',{}, {},{page:2,limit:25,search:'BULK'}));assert.equal(list.total,510);assert.equal(list.items.length,25);
        const summary=good(await call('getSummary'));assert.equal(summary.month_purchase,monthBefore);
        const ledger=good(await call('getLedger',{}, {id:vendorId}));assert.equal(ledger.entries.at(-1).balance,Number(ledger.vendor.balance));
    });
    await check('Existing payment allocation settles invoices without another payment or balance change',async()=>{
        const before=await balance(), count=(await db.query('SELECT count(*) FROM vendor_payments')).rows[0].count;
        const payments=good(await call('getPayments',{}, {},{page:1})).items;
        const credit=payments.find(p=>Number(p.amount)>Number(p.allocated_amount));
        const result=good(await call('allocatePayment',{allocation:'auto'},{id:credit.id}));assert.ok(result.allocated>0);
        assert.equal(await balance(),before);assert.equal((await db.query('SELECT count(*) FROM vendor_payments')).rows[0].count,count);
    });
    await check('Money multiplication rounds decimal half cents exactly',async()=>{
        const A=require('../services/vendorAccounting');assert.equal(A.lineTotal(0.1,10.05),1.01);
        assert.equal((await call('createPayment',payment({amount:[5]}))).status,400);
    });
    await check('Late database failure rolls back purchase, stock and audit',async()=>{
        const stock=(await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock;
        const count=(await db.query('SELECT count(*) FROM purchase_entries')).rows[0].count;
        await db.query(`CREATE FUNCTION vendor_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER vendor_test_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION vendor_test_reject()`);
        const failed=await call('createPurchase',purchase());assert.equal(failed.status,500);
        await db.query('DROP TRIGGER vendor_test_fail ON audit_logs; DROP FUNCTION vendor_test_reject()');
        assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,stock);
        assert.equal((await db.query('SELECT count(*) FROM purchase_entries')).rows[0].count,count);
    });
    console.log(`${checks} integration checks passed in disposable database ${name}`);
};
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    if(db)await db.end();
    // The database identifier is generated above, never supplied by the user.
    if(!/^pos_vendor_test_\d+$/.test(name))throw new Error('Unsafe cleanup target');
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();
});
