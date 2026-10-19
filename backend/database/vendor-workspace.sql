-- Additive upgrade: existing amounts and history are preserved.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_person VARCHAR(150);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email VARCHAR(200);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_terms INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms BETWEEN 0 AND 365);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE purchase_entries ADD COLUMN IF NOT EXISTS invoice_key UUID;
ALTER TABLE purchase_entries ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE purchase_entries ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE purchase_entries ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE purchase_entries ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);
ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS purchase_entry_id INTEGER REFERENCES purchase_entries(id);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS settlement VARCHAR(20) NOT NULL DEFAULT 'legacy' CHECK (settlement IN ('legacy', 'credit', 'refund'));
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS refund_method VARCHAR(20);

CREATE TABLE IF NOT EXISTS vendor_payment_allocations (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES vendor_payments(id),
  purchase_entry_id INTEGER NOT NULL REFERENCES purchase_entries(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  UNIQUE(payment_id, purchase_entry_id)
);
CREATE TABLE IF NOT EXISTS vendor_requests (
  request_key UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  operation VARCHAR(30) NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_allocations_entry ON vendor_payment_allocations(purchase_entry_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoice_key ON purchase_entries(invoice_key);
CREATE INDEX IF NOT EXISTS idx_vendor_purchase_date ON purchase_entries(vendor_id, purchase_date, id);
CREATE INDEX IF NOT EXISTS idx_vendor_return_entry ON purchase_returns(purchase_entry_id);
