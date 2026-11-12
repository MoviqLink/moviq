-- Existing unprotected demo sessions have no credential binding and cannot be reused.
ALTER TABLE commerce_merchant_sessions ADD COLUMN credential_hash TEXT;
