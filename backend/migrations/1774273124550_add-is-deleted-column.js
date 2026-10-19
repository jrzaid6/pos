/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

    CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_products_is_deleted ON products(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_sales_is_deleted ON sales(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_vendors_is_deleted ON vendors(is_deleted);
  `);
};

exports.down = () => {
  throw new Error('Soft-delete flags are required by current application queries and cannot be removed automatically.');
};
