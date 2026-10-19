/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Add theme column to shop_settings (light|dark)
  pgm.addColumn('shop_settings', {
    theme: { type: 'varchar(10)', notNull: true, default: 'light' }
  }, { ifNotExists: true });

  // Add constraint if missing
  pgm.sql(`
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'shop_settings'
              AND constraint_name = 'shop_settings_theme_check'
        ) THEN
            ALTER TABLE shop_settings
            ADD CONSTRAINT shop_settings_theme_check
            CHECK (theme IN ('light', 'dark'));
        END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  // Keep down safe
  pgm.sql(`ALTER TABLE shop_settings DROP CONSTRAINT IF EXISTS shop_settings_theme_check;`);
  pgm.dropColumn('shop_settings', 'theme', { ifExists: true });
};
