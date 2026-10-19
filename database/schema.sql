-- POS System Database Schema
-- PostgreSQL

-- Users table (Admin, Manager, Cashier)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories table
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    brand VARCHAR(100),
    barcode VARCHAR(50) UNIQUE,
    purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    selling_price DECIMAL(12,2) NOT NULL CHECK (selling_price >= 0),
    stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
    cash_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (cash_stock >= 0),
    bank_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (bank_stock >= 0),
    min_stock NUMERIC(14,3) NOT NULL DEFAULT 10 CHECK (min_stock >= 0),
    CHECK (stock = bank_stock + cash_stock),
    unit VARCHAR(30) DEFAULT 'Kg',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customers table
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(20) UNIQUE,
    address TEXT,
    shop_name VARCHAR(200),
    contact_person VARCHAR(150),
    area VARCHAR(120),
    customer_type VARCHAR(30) DEFAULT 'wholesale',
    gst_number VARCHAR(50),
    credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sales table
CREATE TABLE sales (
    id SERIAL PRIMARY KEY,
    bill_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    user_id INTEGER REFERENCES users(id),
    subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    discount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= subtotal),
    total_amount DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'upi', 'udhar', 'split')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'partial')),
    payment_breakdown JSONB NOT NULL DEFAULT '{"cash":0,"upi":0,"credit":0}'::jsonb,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    balance_due DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
    cash_received DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
    change_return DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (change_return >= 0),
    notes TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ABS(total_amount - (subtotal - discount)) <= 0.01),
    CHECK (amount_paid + balance_due <= total_amount + 0.01)
);

-- Sale Items table
CREATE TABLE sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    price DECIMAL(12,2) NOT NULL CHECK (price >= 0),
    total DECIMAL(12,2) NOT NULL CHECK (total >= 0),
    stock_source VARCHAR(20) NOT NULL DEFAULT 'bank' CHECK (stock_source IN ('cash', 'bank'))
);

-- Credit Payments (Udhar system)
CREATE TABLE credit_payments (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    sale_id INTEGER REFERENCES sales(id),
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('credit', 'payment')),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'upi')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Logs
CREATE TABLE inventory_logs (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    change_type VARCHAR(20) CHECK (change_type IN ('purchase', 'sale', 'adjustment', 'return')),
    quantity_change NUMERIC(14,3) NOT NULL,
    previous_stock NUMERIC(14,3),
    new_stock NUMERIC(14,3),
    notes TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vendors and purchasing records
CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(30),
    address TEXT,
    gst_number VARCHAR(30),
    opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_entries (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('cash', 'bank')),
    invoice_no VARCHAR(80),
    purchase_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'partial', 'unpaid')),
    paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    due_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (due_amount >= 0),
    note TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_cash_transactions (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    purchase_entry_id INTEGER REFERENCES purchase_entries(id) ON DELETE SET NULL,
    section VARCHAR(20) NOT NULL CHECK (section IN ('cash', 'bank')),
    transaction_type VARCHAR(30) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    payment_method VARCHAR(20),
    reference TEXT,
    note TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vendor_payments (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    method VARCHAR(20) NOT NULL DEFAULT 'bank' CHECK (method IN ('bank', 'cash', 'upi')),
    reference TEXT,
    note TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_returns (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    source VARCHAR(20) NOT NULL CHECK (source IN ('cash', 'bank')),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    note TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Shop Settings
CREATE TABLE shop_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    shop_name VARCHAR(200) DEFAULT 'My Shop',
    address TEXT,
    phone VARCHAR(20),
    email VARCHAR(100),
    gst_number VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'INR',
    bill_prefix VARCHAR(10) DEFAULT 'BILL',
    logo_url TEXT,
    bill_footer TEXT DEFAULT 'Thank you for shopping!',
    thank_you_note TEXT DEFAULT 'Visit Again',
    gst_enabled BOOLEAN DEFAULT true,
    tax_percent DECIMAL(5,2) DEFAULT 0,
    financial_year_start VARCHAR(10) DEFAULT '04-01',
    low_stock_threshold INTEGER DEFAULT 10,
    printer_type VARCHAR(20) DEFAULT '80mm',
    invoice_format VARCHAR(20) DEFAULT 'thermal',
    print_preview BOOLEAN DEFAULT true,
    default_payment_method VARCHAR(20) DEFAULT 'cash',
    default_customer_label VARCHAR(100) DEFAULT 'Walk-in Customer',
    default_report_period VARCHAR(20) DEFAULT 'month',
    session_timeout_minutes INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id INTEGER,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active_name ON products(name) WHERE is_active = true AND is_deleted = false;
CREATE INDEX idx_sales_date_id ON sales(created_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX idx_sales_customer_date ON sales(customer_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);
CREATE INDEX idx_credit_customer_date ON credit_payments(customer_id, created_at DESC, id DESC);
CREATE INDEX idx_credit_sale ON credit_payments(sale_id);
CREATE INDEX idx_inventory_logs_product_date ON inventory_logs(product_id, created_at DESC, id DESC);
CREATE INDEX idx_purchase_entries_product_date ON purchase_entries(product_id, purchase_date DESC, id DESC);
CREATE INDEX idx_purchase_entries_vendor_date ON purchase_entries(vendor_id, purchase_date DESC, id DESC);
CREATE INDEX idx_bank_cash_section_date ON bank_cash_transactions(section, created_at DESC, id DESC);
CREATE INDEX idx_vendor_payments_vendor_date ON vendor_payments(vendor_id, created_at DESC, id DESC);
CREATE INDEX idx_purchase_returns_vendor_date ON purchase_returns(vendor_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_created_at_id ON audit_logs (created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_user_created_at ON audit_logs (user_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_action_created_at ON audit_logs (action, created_at DESC, id DESC);

-- Provision the first admin with `npm run create-admin` after configuring backend/.env.

-- Insert default shop settings
INSERT INTO shop_settings (shop_name, address, phone) 
VALUES ('My Shop', 'Shop Address', '1234567890');

-- Insert standard wholesale categories
INSERT INTO categories (name) VALUES 
('Dal'),
('Oil'),
('Atta'),
('Sugar'),
('Spices'),
('General');
