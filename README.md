# POS

Wholesale shop POS built with React, Vite, Node.js, Express and PostgreSQL.

## Included features

- Billing, products, barcode lookup and inventory tracking.
- Customer accounts, credit payments and outstanding balances.
- Vendor purchasing and cash/bank records.
- Reports, staff accounts, shop settings, audit logs and backup export.

This repository is a development snapshot. Accounting, stock correctness and recovery checks still need work before relying on it for final shop accounts.

## Download

Choose **Code > Download ZIP**, or clone:

```sh
git clone https://github.com/jrzaid6/pos.git
cd pos
```

The original local Git history, local secrets, installed dependencies, runtime logs, generated audit reports and shop database contents are excluded from this source snapshot. Repository downloads contain the app source and schema, not customer, stock or financial records.

## Local setup

Prerequisites: a current supported Node.js release with npm, and a local PostgreSQL server.

1. Install the backend dependencies with `npm ci` inside `backend`.
2. Copy `backend/.env.example` to `backend/.env`, and set your own database credentials, private JWT secret and initial admin details.
3. Create an empty PostgreSQL database with the same name as `DB_NAME`.
4. Run `npm run migrate` inside `backend` for a fresh database.
5. Run `npm run create-admin` inside `backend` to provision the first admin using the environment values. There is no shared default login password.
6. Run `npm start` inside `backend`. The default API port is 5001.
7. In a second terminal, run `npm ci` and then `npm run dev` inside `frontend`. Vite uses port 3000 and proxies `/api` to port 5001.
8. Open `http://localhost:3000` and sign in with the admin account you created.

Use the standard `npm ci` command for the current backend snapshot; its PostgreSQL driver is currently listed under development dependencies.

See `database/README.md` for database bootstrap precautions. Existing shop databases require a reviewed upgrade and a verified backup; never apply fresh-install SQL blindly to live shop data.

## Repository layout

```text
backend/             API, controllers, services, migrations and scripts
frontend/            React user interface
database/            Canonical schema and setup notes
backend/.env.example Local configuration template without real credentials
```

## Recovery and ongoing work

Keep encrypted database backups separately. A GitHub source ZIP does not restore sales, customers or balances. The current app has data export but a complete restore process still needs verification.

For later code changes, commit and push them to keep the GitHub snapshot current. Uploading this snapshot does not enable automatic sync from the original local folder.
