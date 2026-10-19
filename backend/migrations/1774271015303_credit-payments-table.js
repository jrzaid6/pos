/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 11. Credit Payments Table
  pgm.createTable('credit_payments', {
    id: 'id',
    customer_id: { type: 'integer', references: 'customers', onDelete: 'CASCADE' },
    sale_id: { type: 'integer', references: 'sales', onDelete: 'SET NULL' },
    amount: { type: 'decimal(10, 2)', notNull: true },
    payment_type: { type: 'varchar(20)', notNull: true }, // 'credit' (udhar liya) or 'payment' (udhar chukaya)
    payment_method: { type: 'varchar(20)', default: 'cash' }, // 'cash', 'upi' (for 'payment' type)
    notes: { type: 'text' },
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') },
  }, { ifNotExists: true });

  pgm.sql(`
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'credit_payments'
              AND constraint_name = 'credit_payments_payment_type_check'
        ) THEN
            ALTER TABLE credit_payments
            ADD CONSTRAINT credit_payments_payment_type_check
            CHECK (payment_type IN ('credit', 'payment'));
        END IF;
    END $$;
  `);
  
  pgm.createIndex('credit_payments', ['customer_id', 'created_at'], { ifNotExists: true });
};

exports.down = (pgm) => {
  // We don't want to drop the table if we are just fixing the migration, 
  // but for 'down' it's technically correct to drop it if we created it.
  // Since we are adopting, we might leave this empty or be careful.
  // pgm.dropTable('credit_payments', { ifExists: true });
};
