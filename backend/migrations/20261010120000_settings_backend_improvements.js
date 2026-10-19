/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_id
      ON audit_logs (created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at
      ON audit_logs (user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at
      ON audit_logs (action, created_at DESC, id DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_audit_logs_action_created_at;
    DROP INDEX IF EXISTS idx_audit_logs_user_created_at;
    DROP INDEX IF EXISTS idx_audit_logs_created_at_id;
    -- Keep auth columns: current runtime and issued JWTs depend on them.
  `);
};
