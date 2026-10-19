/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products
      ALTER COLUMN stock TYPE NUMERIC(14,3) USING stock::numeric,
      ALTER COLUMN cash_stock TYPE NUMERIC(14,3) USING cash_stock::numeric,
      ALTER COLUMN bank_stock TYPE NUMERIC(14,3) USING bank_stock::numeric,
      ALTER COLUMN min_stock TYPE NUMERIC(14,3) USING min_stock::numeric;

    ALTER TABLE sale_items
      ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::numeric;

    ALTER TABLE inventory_logs
      ALTER COLUMN quantity_change TYPE NUMERIC(14,3) USING quantity_change::numeric,
      ALTER COLUMN previous_stock TYPE NUMERIC(14,3) USING previous_stock::numeric,
      ALTER COLUMN new_stock TYPE NUMERIC(14,3) USING new_stock::numeric;

    ALTER TABLE purchase_entries
      ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::numeric;

    ALTER TABLE purchase_returns
      ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::numeric;
  `);
};

exports.down = () => {
  throw new Error('Fractional quantities may already exist; narrowing stock columns back to integers would lose data. Restore a verified backup instead.');
};
