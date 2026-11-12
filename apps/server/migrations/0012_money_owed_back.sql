-- Money MovIQ owes back, followed apart from the hold or the batch it came from.

-- A refund PayPal has not confirmed (`unknown`) is looked at again by reconciliation until it
-- ends; `checks` spaces the looks out. A completed refund never changes again.
ALTER TABLE payment_hold_refunds ADD COLUMN checks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_hold_refunds ADD COLUMN next_check_at TEXT;

UPDATE payment_hold_refunds SET next_check_at = updated_at WHERE status = 'unknown';

CREATE INDEX payment_hold_refunds_due ON payment_hold_refunds (next_check_at)
  WHERE status = 'unknown';

CREATE TRIGGER payment_hold_refunds_completed_is_final
BEFORE UPDATE OF status ON payment_hold_refunds
WHEN OLD.status = 'completed' AND NEW.status <> 'completed'
BEGIN
  SELECT RAISE(ABORT, 'a completed refund is final');
END;

-- The release of an authorization whose purchase was refused: owed from the refusal, in the same
-- transaction, and met only when PayPal confirms the money is released.
CREATE TABLE payment_hold_releases (
  hold_id TEXT PRIMARY KEY REFERENCES payment_holds (id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('owed', 'released')),
  checks INTEGER NOT NULL DEFAULT 0,
  next_check_at TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'owed') = (next_check_at IS NOT NULL))
) STRICT;

CREATE INDEX payment_hold_releases_due ON payment_hold_releases (next_check_at)
  WHERE status = 'owed';

CREATE TRIGGER payment_hold_releases_released_is_final
BEFORE UPDATE OF status ON payment_hold_releases
WHEN OLD.status = 'released' AND NEW.status <> 'released'
BEGIN
  SELECT RAISE(ABORT, 'a release is final');
END;

-- A payout batch pays sales and deducts refunds the merchant bears, each key in at most one live
-- batch (`payout_items_paid_once`). `gross_minor` is the sales less `refunds_minor`.
ALTER TABLE payout_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'sale'
  CHECK (kind IN ('sale', 'refund'));
ALTER TABLE payout_batches ADD COLUMN refunds_minor INTEGER NOT NULL DEFAULT 0
  CHECK (refunds_minor >= 0);
