# POS database setup

`schema.sql` is the canonical schema used by the initial migration. Create an empty PostgreSQL database, set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `backend/.env`, then run `npm run migrate` from `backend`.

The schema intentionally does not insert a shared default admin password. Set `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, and a private `INITIAL_ADMIN_PASSWORD` (12–128 characters) in `backend/.env`, then run `npm run create-admin` from `backend`. The setup command refuses to overwrite an existing active admin.

Do not run the fresh-install migration against a database that already contains shop data unless its migration history has been checked and a verified backup exists. The migration runner refuses to adopt existing tables automatically; this protects a live POS database from an accidental baseline migration. Existing installations need a reviewed upgrade migration based on their actual schema and migration history.
