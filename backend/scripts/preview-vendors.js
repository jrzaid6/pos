// Disposable local UI fixture; never connects the preview app to shop data.
const fs=require('fs'),path=require('path');
require('dotenv').config({path:path.join(__dirname,'../.env')});
const {Pool}=require('pg');const {randomUUID,randomBytes}=require('crypto');
const name=`pos_vendor_preview_${Date.now()}`;
const base={host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD};
const admin=new Pool({...base,database:'postgres'});
const password=randomBytes(16).toString('hex');
async function run(){
    await admin.query(`CREATE DATABASE "${name}"`);
    process.env.DB_NAME=name;process.env.JWT_SECRET=randomBytes(32).toString('hex');
    const db=require('../config/database');
    await db.query(fs.readFileSync(path.join(__dirname,'../../database/schema.sql'),'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname,'../database/vendor-workspace.sql'),'utf8'));
    const hash=await require('bcryptjs').hash(password,10);
    const user=(await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Preview Admin','preview@example.invalid',$1,'admin') RETURNING id",[hash])).rows[0];
    const p=(await db.query("INSERT INTO products(name,purchase_price,selling_price,unit) VALUES('Premium Basmati Rice',85,100,'Kg'),('Sunflower Oil',120,145,'Ltr') RETURNING id")).rows;
    const controller=require('../controllers/vendorController');
    async function call(fn,body){let result;await controller[fn]({body,params:{},query:{},user:{id:user.id},headers:{'idempotency-key':randomUUID()}},{status(n){if(n>=400)console.error('fixture status',n);return this},json(data){result=data}});return result;}
    const v=await call('saveVendor',{name:'Aarav Wholesale Traders',contact_person:'Aarav Shah',phone:'9876543210',email:'accounts@example.invalid',address:'Market Road, Pune',opening_balance:5000,payment_terms:14});
    await call('saveVendor',{name:'Green Valley Foods',contact_person:'Meera Patel',phone:'9876543211',opening_balance:0,payment_terms:30});
    await call('createPurchase',{vendor_id:v.id,invoice_no:'AW-2026-0142',purchase_date:'2026-10-10',due_date:'2026-10-24',paid_amount:5000,payment_method:'bank',items:[{product_id:p[0].id,quantity:250,purchase_price:85,source:'bank'},{product_id:p[1].id,quantity:50,purchase_price:120,source:'bank'}]});
    await call('createPayment',{vendor_id:v.id,amount:2500,method:'upi',payment_date:'2026-10-16',allocation:'auto',reference:'Preview payment'});
    const express=require('express'),app=express();app.use(express.json());
    app.use('/api/auth',require('../routes/auth'));app.use('/api/products',require('../routes/products'));app.use('/api/bank-cash',require('../routes/bankCash'));app.use('/api/settings',require('../routes/settings'));
    app.listen(5002,'127.0.0.1',()=>console.log(JSON.stringify({database:name,email:'preview@example.invalid',password,backend:5002})));
    await admin.end();
}
run().catch(e=>{console.error(e);process.exitCode=1});
