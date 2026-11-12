-- One session-owned virtual bus ride at a time, with its last real GPS reading.
CREATE TABLE virtual_rides (
  id TEXT PRIMARY KEY, traveller_id TEXT NOT NULL REFERENCES travellers(id),
  vehicle_id TEXT NOT NULL, trip_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('following', 'lost', 'ended')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)), updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL, journey_id TEXT REFERENCES journeys(id), journey_offer_id TEXT,
  plan_token TEXT, plan_locked_until TEXT
) STRICT;
CREATE UNIQUE INDEX virtual_one_active ON virtual_rides(traveller_id) WHERE state != 'ended';
CREATE TABLE virtual_invitations (
  id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES virtual_rides(id),
  stop_id TEXT NOT NULL, merchant_id TEXT NOT NULL REFERENCES commerce_merchants(id),
  item_id TEXT NOT NULL, item_name TEXT NOT NULL, price_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  request_token TEXT, request_locked_until TEXT,
  UNIQUE (ride_id, stop_id, merchant_id, item_id)
) STRICT;
CREATE INDEX virtual_invitations_by_ride ON virtual_invitations(ride_id, created_at);
CREATE TABLE virtual_ride_needs (
  ride_id TEXT NOT NULL REFERENCES virtual_rides(id),
  need_id TEXT NOT NULL UNIQUE REFERENCES commerce_needs(id),
  invitation_id TEXT NOT NULL UNIQUE REFERENCES virtual_invitations(id),
  merchant_id TEXT NOT NULL REFERENCES commerce_merchants(id),
  created_at TEXT NOT NULL, origin_json TEXT, validation_offer_id TEXT,
  validation_plan_id TEXT, validation_expires_at TEXT, validation_depart_at TEXT, estimate_token TEXT,
  PRIMARY KEY (ride_id, need_id)
) STRICT;
CREATE INDEX virtual_needs_by_merchant ON virtual_ride_needs(merchant_id, need_id);
