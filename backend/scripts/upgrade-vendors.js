// Narrow additive upgrade for installations whose historical migration files
// are incomplete. Does not adopt, reorder or rerun their baseline migrations.
require('dotenv').config();
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const pool=require('../config/database');
async function run(){
    const backup=process.argv[2];
    if(!backup||!fs.statSync(backup).isFile())throw new Error('Pass the path to a verified PostgreSQL custom-format backup.');
    const pgRestore=process.env.PG_RESTORE_PATH||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe':'pg_restore');
    const toc=execFileSync(pgRestore,['-l',path.resolve(backup)],{encoding:'utf8'});
    for(const table of ['vendors','purchase_entries','vendor_payments'])if(!toc.includes(`TABLE DATA public ${table}`))throw new Error('Backup is missing vendor tables');
    const c=await pool.connect();
    try{
        await c.query('BEGIN');
        await c.query("SELECT pg_advisory_xact_lock(hashtext('pos-vendor-upgrade-v1'))");
        const columns=(await c.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")).rows;
        for(const [table,col] of [['vendors','opening_balance'],['purchase_entries','paid_amount'],['products','bank_stock'],['products','cash_stock'],['audit_logs','details']]){
            if(!columns.some(r=>r.table_name===table&&r.column_name===col))throw new Error(`Missing required column ${table}.${col}`);
        }
        await c.query(fs.readFileSync(path.join(__dirname,'../database/vendor-workspace.sql'),'utf8'));
        await c.query('COMMIT');console.log('Vendor additive schema upgrade completed. Existing records preserved.');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
