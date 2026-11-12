-- Commerce on the way, and the money it moves: holds on the traveller's PayPal (authorize when
-- reserving, capture when collecting, void when cancelling), payouts to merchants, and the demo
-- merchants with their menus and agents. Amounts are integer minor units with their currency;
-- instants are UTC text written by `toInstant`.

-- A hold: an order of intent AUTHORIZE. It starts `unknown` (PayPal has not answered) and only
-- moves along the transitions below. `pending` says what an `unknown` hold waits for.
CREATE TABLE payment_holds (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  purpose TEXT NOT NULL,
  purpose_key TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 127),
  -- What PayPal shows the buyer: the lines, the brand and the language of its window.
  presentation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('unknown', 'created', 'authorized', 'captured', 'voided', 'failed')
  ),
  pending TEXT CHECK (pending IN ('create', 'authorize', 'capture', 'void')),
  paypal_order_id TEXT UNIQUE,
  paypal_authorization_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  captured_minor INTEGER NOT NULL DEFAULT 0 CHECK (captured_minor >= 0),
  paypal_status TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_check_at TEXT,
  checks INTEGER NOT NULL DEFAULT 0 CHECK (checks >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK ((status = 'unknown') = (pending IS NOT NULL)),
  CHECK (captured_minor <= amount_minor)
) STRICT;

-- One live hold per traveller and purchase: a repeated reservation finds it.
CREATE UNIQUE INDEX payment_holds_one_open
  ON payment_holds (traveller_id, purpose_key)
  WHERE status IN ('unknown', 'created', 'authorized', 'captured');

CREATE INDEX payment_holds_due ON payment_holds (next_check_at) WHERE next_check_at IS NOT NULL;

CREATE TABLE payment_hold_transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
) STRICT;

INSERT INTO payment_hold_transitions (from_status, to_status) VALUES
  ('unknown', 'created'),
  ('unknown', 'authorized'),
  ('unknown', 'captured'),
  ('unknown', 'voided'),
  ('unknown', 'failed'),
  ('created', 'unknown'),
  ('created', 'failed'),
  ('created', 'voided'),
  ('authorized', 'unknown');

CREATE TRIGGER payment_holds_start_unknown
BEFORE INSERT ON payment_holds
WHEN NEW.status <> 'unknown'
BEGIN
  SELECT RAISE(ABORT, 'a hold starts unknown');
END;

CREATE TRIGGER payment_holds_allowed_transition
BEFORE UPDATE OF status ON payment_holds
WHEN NEW.status <> OLD.status AND NOT EXISTS (
  SELECT 1 FROM payment_hold_transitions
  WHERE from_status = OLD.status AND to_status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'hold status transition not allowed');
END;

CREATE TABLE payment_hold_history (
  id INTEGER PRIMARY KEY,
  hold_id TEXT NOT NULL REFERENCES payment_holds (id),
  at TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  pending TEXT,
  source TEXT NOT NULL CHECK (source IN ('api', 'reconciliation')),
  detail TEXT
) STRICT;

CREATE INDEX payment_hold_history_by_hold ON payment_hold_history (hold_id, id);

-- Money given back from a captured hold. The operation names what is refunded (a missing line)
-- and is the PayPal-Request-Id, so the same refund is never given twice.
CREATE TABLE payment_hold_refunds (
  hold_id TEXT NOT NULL REFERENCES payment_holds (id),
  operation TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (status IN ('unknown', 'completed', 'failed')),
  paypal_refund_id TEXT UNIQUE,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (hold_id, operation)
) STRICT;

-- Payouts to merchants. A batch is written before PayPal is asked (`unknown`), with its items;
-- an order is in at most one batch that has not failed, so the same sale is never paid twice.
CREATE TABLE payout_batches (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  receiver TEXT NOT NULL,
  until TEXT NOT NULL,
  gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
  fee_minor INTEGER NOT NULL CHECK (fee_minor >= 0),
  net_minor INTEGER NOT NULL CHECK (net_minor > 0 AND net_minor = gross_minor - fee_minor),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (
    status IN ('unknown', 'pending', 'processing', 'success', 'denied', 'canceled', 'failed')
  ),
  paypal_batch_id TEXT UNIQUE,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_check_at TEXT,
  version INTEGER NOT NULL CHECK (version > 0)
) STRICT;

CREATE INDEX payout_batches_by_merchant ON payout_batches (merchant_id, created_at);
CREATE INDEX payout_batches_due ON payout_batches (next_check_at) WHERE next_check_at IS NOT NULL;

CREATE TABLE payout_items (
  batch_id TEXT NOT NULL REFERENCES payout_batches (id),
  item_key TEXT NOT NULL,
  gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  PRIMARY KEY (batch_id, item_key)
) STRICT;

CREATE UNIQUE INDEX payout_items_paid_once ON payout_items (item_key) WHERE active = 1;

-- Merchants. Every one is a demo (`demo = 1`, id `demo-…`): name, menu and prices are examples.
-- Each sits next to a real MTA bus stop, with the stop's id, name and position from OpenStreetMap
-- (© OpenStreetMap contributors, ODbL).
CREATE TABLE commerce_merchants (
  id TEXT PRIMARY KEY CHECK (id LIKE 'demo-%'),
  demo INTEGER NOT NULL CHECK (demo = 1),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('restaurant', 'cafe', 'shop')),
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  stop_id TEXT NOT NULL,
  stop_name TEXT NOT NULL,
  stop_lat REAL NOT NULL,
  stop_lon REAL NOT NULL,
  stop_routes TEXT NOT NULL,
  walk_minutes INTEGER NOT NULL CHECK (walk_minutes > 0),
  -- New York wall-clock hours, every day.
  opens_at TEXT NOT NULL CHECK (opens_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  closes_at TEXT NOT NULL CHECK (closes_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  code_letter TEXT NOT NULL UNIQUE CHECK (code_letter GLOB '[A-Z]'),
  -- Where payouts go. Fixed for demo merchants: no session can change it.
  payout_receiver TEXT NOT NULL
) STRICT;

-- The menu. Ingredients carry their allergens and whether the kitchen can leave them out;
-- extras are what it can add, at their price.
CREATE TABLE commerce_menu_items (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES commerce_merchants (id),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('meal', 'coffee', 'snack', 'drink', 'goods')),
  price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  cost_minor INTEGER NOT NULL CHECK (cost_minor > 0 AND cost_minor < price_minor),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  diet TEXT NOT NULL CHECK (diet IN ('any', 'vegetarian', 'vegan')),
  alcohol INTEGER NOT NULL CHECK (alcohol IN (0, 1)),
  ingredients TEXT NOT NULL,
  extras TEXT NOT NULL,
  keywords TEXT NOT NULL
) STRICT;

CREATE INDEX commerce_menu_items_by_merchant ON commerce_menu_items (merchant_id);

-- What each merchant's agent may do on its own, edited in "Your agent".
CREATE TABLE commerce_agent_rules (
  merchant_id TEXT PRIMARY KEY REFERENCES commerce_merchants (id),
  rules TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0)
) STRICT;

-- Demo sessions of the merchant panel. Only a hash of the session id is stored.
CREATE TABLE commerce_merchant_sessions (
  id_hash TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES commerce_merchants (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

-- A traveller's need ("ramen", "a coffee") and the window to collect it on the way. The taste
-- is kept to compose and check offers; merchants only ever see the need message of their thread.
CREATE TABLE commerce_needs (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  craving TEXT NOT NULL,
  alias TEXT NOT NULL,
  taste TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'es')),
  journey_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX commerce_needs_by_traveller ON commerce_needs (traveller_id, created_at);

-- One conversation per need and merchant, between Sara and that merchant's agent.
CREATE TABLE commerce_threads (
  id TEXT PRIMARY KEY,
  need_id TEXT NOT NULL REFERENCES commerce_needs (id),
  merchant_id TEXT NOT NULL REFERENCES commerce_merchants (id),
  status TEXT NOT NULL CHECK (status IN ('negotiating', 'awaiting-traveller', 'offered', 'closed')),
  -- When the traveller passes the merchant's stop, and until when they can collect.
  pass_at TEXT NOT NULL,
  pickup_before TEXT NOT NULL,
  clarifications INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  question TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  UNIQUE (need_id, merchant_id)
) STRICT;

CREATE INDEX commerce_threads_by_merchant ON commerce_threads (merchant_id, created_at);

-- The messages of each conversation, in order, validated against the protocol before written.
CREATE TABLE commerce_messages (
  thread_id TEXT NOT NULL REFERENCES commerce_threads (id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (thread_id, seq)
) STRICT;

-- Offers the server validated. Prices were checked against the menu, the program's minimum
-- reward, the agent's rules, capacity and the traveller's preferences before being written.
CREATE TABLE commerce_offers (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE REFERENCES commerce_threads (id),
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  merchant_id TEXT NOT NULL REFERENCES commerce_merchants (id),
  lines TEXT NOT NULL,
  list_minor INTEGER NOT NULL CHECK (list_minor > 0),
  price_minor INTEGER NOT NULL CHECK (price_minor > 0 AND price_minor < list_minor),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  pickup_at TEXT NOT NULL,
  detour_minutes INTEGER NOT NULL CHECK (detour_minutes >= 0),
  note TEXT NOT NULL,
  composer TEXT NOT NULL CHECK (composer IN ('model', 'rules')),
  recommended INTEGER NOT NULL CHECK (recommended IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('open', 'declined', 'reserved', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- Orders exist only once PayPal confirmed the hold. The code is what the counter calls out.
CREATE TABLE commerce_orders (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL UNIQUE REFERENCES commerce_offers (id),
  hold_id TEXT NOT NULL UNIQUE REFERENCES payment_holds (id),
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  merchant_id TEXT NOT NULL REFERENCES commerce_merchants (id),
  code TEXT NOT NULL,
  alias TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'preparing', 'ready', 'picked_up', 'cancelled')),
  pickup_at TEXT NOT NULL,
  kitchen_starts_at TEXT NOT NULL,
  ticket TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  picked_up_at TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  UNIQUE (merchant_id, code)
) STRICT;

CREATE INDEX commerce_orders_by_merchant ON commerce_orders (merchant_id, pickup_at);

CREATE TABLE commerce_order_transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
) STRICT;

INSERT INTO commerce_order_transitions (from_status, to_status) VALUES
  ('reserved', 'preparing'),
  ('reserved', 'ready'),
  ('reserved', 'picked_up'),
  ('reserved', 'cancelled'),
  ('preparing', 'ready'),
  ('preparing', 'picked_up'),
  ('ready', 'picked_up');

CREATE TRIGGER commerce_orders_allowed_transition
BEFORE UPDATE OF status ON commerce_orders
WHEN NEW.status <> OLD.status AND NOT EXISTS (
  SELECT 1 FROM commerce_order_transitions
  WHERE from_status = OLD.status AND to_status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'order status transition not allowed');
END;

-- Signed pickup codes. Each is used once: the scan that charges marks it in the same transaction.
CREATE TABLE commerce_pickup_codes (
  nonce TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders (id),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
) STRICT;

CREATE INDEX commerce_pickup_codes_by_order ON commerce_pickup_codes (order_id, expires_at);

-- The demo merchants, on the M60 in Morningside Heights and Harlem.
INSERT INTO commerce_merchants (id, demo, name, kind, lat, lon, stop_id, stop_name, stop_lat,
  stop_lon, stop_routes, walk_minutes, opens_at, closes_at, code_letter, payout_receiver) VALUES
  ('demo-morningside-grind', 1, 'Morningside Grind', 'cafe', 40.807957, -73.963313, '403122',
    'Broadway & West 116th Street', 40.807777, -73.963847, '["M60"]', 1, '07:00', '20:00', 'M',
    'demo-morningside-grind@example.com'),
  ('demo-amsterdam-bagel-works', 1, 'Amsterdam Bagel Works', 'cafe', 40.809864, -73.959633,
    '401442', 'Amsterdam Avenue & West 120th Street', 40.80955, -73.958921, '["M60"]', 2,
    '06:30', '16:00', 'B', 'demo-amsterdam-bagel-works@example.com'),
  ('demo-green-line-poke', 1, 'Green Line Poke', 'restaurant', 40.807377, -73.964347, '403122',
    'Broadway & West 116th Street', 40.807777, -73.963847, '["M60"]', 1, '11:00', '22:00', 'G',
    'demo-green-line-poke@example.com'),
  ('demo-tsuki-ramen-house', 1, 'Tsuki Ramen House', 'restaurant', 40.803558, -73.937307,
    '403671', 'East 125th Street & Lexington Avenue', 40.804052, -73.936892, '["M60"]', 2,
    '11:30', '23:00', 'T', 'demo-tsuki-ramen-house@example.com'),
  ('demo-uptown-smash-co', 1, 'Uptown Smash Co.', 'restaurant', 40.805787, -73.940905, '402661',
    'East 125th Street & Madison Avenue', 40.805487, -73.940305, '["M60"]', 1, '11:00', '23:00',
    'U', 'demo-uptown-smash-co@example.com'),
  ('demo-uptown-corner-goods', 1, 'Uptown Corner Goods', 'shop', 40.805936, -73.93983, '402661',
    'East 125th Street & Madison Avenue', 40.805487, -73.940305, '["M60"]', 2, '08:00', '21:00',
    'C', 'demo-uptown-corner-goods@example.com');

INSERT INTO commerce_menu_items (id, merchant_id, name, category, price_minor, cost_minor,
  currency, diet, alcohol, ingredients, extras, keywords) VALUES
  ('mg-latte', 'demo-morningside-grind', 'Latte', 'coffee', 575, 160, 'USD', 'vegetarian', 0,
    json_array(
      json_object('name', 'espresso', 'allergens', json_array(), 'removable', json('false')),
      json_object(
        'name', 'steamed milk',
        'allergens', json_array('milk'),
        'removable', json('true')
      )
    ),
    json_array(
      json_object('name', 'oat milk', 'priceMinor', 75, 'allergens', json_array()),
      json_object('name', 'extra shot', 'priceMinor', 100, 'allergens', json_array())
    ),
    '["coffee","latte","cafe","espresso"]'),
  ('mg-cold-brew', 'demo-morningside-grind', 'Cold brew', 'coffee', 525, 120, 'USD', 'vegan', 0,
    '[{"name":"cold brew coffee","allergens":[],"removable":false}]',
    json_array(
      json_object('name', 'oat milk', 'priceMinor', 75, 'allergens', json_array()),
      json_object('name', 'vanilla syrup', 'priceMinor', 50, 'allergens', json_array())
    ),
    '["coffee","cold brew","cafe","iced"]'),
  ('mg-croissant', 'demo-morningside-grind', 'Butter croissant', 'snack', 425, 130, 'USD',
    'vegetarian', 0,
    json_array(
      json_object(
        'name', 'wheat flour',
        'allergens', json_array('wheat'),
        'removable', json('false')
      ),
      json_object('name', 'butter', 'allergens', json_array('milk'), 'removable', json('false')),
      json_object('name', 'egg wash', 'allergens', json_array('eggs'), 'removable', json('false'))
    ),
    '[]', '["croissant","pastry","snack","bolleria","merienda"]'),
  ('mg-cola', 'demo-morningside-grind', 'Cola', 'drink', 300, 90, 'USD', 'vegan', 0,
    '[{"name":"cola","allergens":[],"removable":false}]', '[]', '["cola","soda","refresco"]'),
  ('ab-everything-bagel', 'demo-amsterdam-bagel-works', 'Everything bagel with cream cheese',
    'meal', 650, 190, 'USD', 'vegetarian', 0,
    json_array(
      json_object('name', 'bagel', 'allergens', json_array('wheat'), 'removable', json('false')),
      json_object(
        'name', 'sesame seeds',
        'allergens', json_array('sesame'),
        'removable', json('false')
      ),
      json_object(
        'name', 'cream cheese',
        'allergens', json_array('milk'),
        'removable', json('true')
      ),
      json_object('name', 'scallions', 'allergens', json_array(), 'removable', json('true'))
    ),
    json_array(
      json_object('name', 'smoked salmon', 'priceMinor', 450, 'allergens', json_array('fish')),
      json_object('name', 'tomato', 'priceMinor', 75, 'allergens', json_array())
    ),
    '["bagel","breakfast","desayuno","hungry","hambre"]'),
  ('ab-egg-sandwich', 'demo-amsterdam-bagel-works', 'Egg and cheese on a roll', 'meal', 725, 220,
    'USD', 'vegetarian', 0,
    json_array(
      json_object('name', 'roll', 'allergens', json_array('wheat'), 'removable', json('false')),
      json_object('name', 'egg', 'allergens', json_array('eggs'), 'removable', json('false')),
      json_object('name', 'cheddar', 'allergens', json_array('milk'), 'removable', json('true')),
      json_object('name', 'hot sauce', 'allergens', json_array(), 'removable', json('true'))
    ),
    '[{"name":"avocado","priceMinor":150,"allergens":[]}]',
    '["sandwich","breakfast","desayuno","egg","hungry","hambre","bocadillo"]'),
  ('ab-coffee', 'demo-amsterdam-bagel-works', 'Drip coffee', 'coffee', 300, 60, 'USD', 'vegetarian',
    0,
    json_array(
      json_object('name', 'coffee', 'allergens', json_array(), 'removable', json('false')),
      json_object('name', 'milk', 'allergens', json_array('milk'), 'removable', json('true'))
    ),
    '[]', '["coffee","cafe"]'),
  ('ab-orange-juice', 'demo-amsterdam-bagel-works', 'Orange juice', 'drink', 450, 150, 'USD',
    'vegan', 0, '[{"name":"orange juice","allergens":[],"removable":false}]', '[]',
    '["orange juice","juice","zumo"]'),
  ('gp-salmon-bowl', 'demo-green-line-poke', 'Salmon poke bowl', 'meal', 1595, 560, 'USD', 'any',
    0,
    json_array(
      json_object('name', 'sushi rice', 'allergens', json_array(), 'removable', json('false')),
      json_object('name', 'salmon', 'allergens', json_array('fish'), 'removable', json('false')),
      json_object('name', 'edamame', 'allergens', json_array('soy'), 'removable', json('true')),
      json_object(
        'name', 'seaweed salad',
        'allergens', json_array('sesame'),
        'removable', json('true')
      ),
      json_object('name', 'scallions', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'spicy mayo', 'allergens', json_array('eggs'), 'removable', json('true'))
    ),
    json_array(
      json_object('name', 'avocado', 'priceMinor', 200, 'allergens', json_array()),
      json_object('name', 'extra salmon', 'priceMinor', 400, 'allergens', json_array('fish'))
    ),
    '["poke","bowl","salmon","hungry","hambre","lunch","dinner","cena","comida"]'),
  ('gp-tofu-bowl', 'demo-green-line-poke', 'Tofu poke bowl', 'meal', 1395, 420, 'USD', 'vegan', 0,
    json_array(
      json_object('name', 'sushi rice', 'allergens', json_array(), 'removable', json('false')),
      json_object('name', 'tofu', 'allergens', json_array('soy'), 'removable', json('false')),
      json_object('name', 'edamame', 'allergens', json_array('soy'), 'removable', json('true')),
      json_object('name', 'cucumber', 'allergens', json_array(), 'removable', json('true')),
      json_object(
        'name', 'sesame dressing',
        'allergens', json_array('sesame'),
        'removable', json('true')
      ),
      json_object('name', 'scallions', 'allergens', json_array(), 'removable', json('true'))
    ),
    json_array(
      json_object('name', 'avocado', 'priceMinor', 200, 'allergens', json_array()),
      json_object('name', 'mango', 'priceMinor', 150, 'allergens', json_array())
    ),
    '["poke","bowl","tofu","vegan","hungry","hambre","lunch","dinner","cena","comida"]'),
  ('gp-cola', 'demo-green-line-poke', 'Cola', 'drink', 300, 90, 'USD', 'vegan', 0,
    '[{"name":"cola","allergens":[],"removable":false}]', '[]', '["cola","soda","refresco"]'),
  ('tr-tonkotsu', 'demo-tsuki-ramen-house', 'Tonkotsu ramen', 'meal', 1795, 600, 'USD', 'any', 0,
    json_array(
      json_object(
        'name', 'wheat noodles',
        'allergens', json_array('wheat'),
        'removable', json('false')
      ),
      json_object('name', 'pork broth', 'allergens', json_array(), 'removable', json('false')),
      json_object('name', 'chashu pork', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'soft egg', 'allergens', json_array('eggs'), 'removable', json('true')),
      json_object('name', 'scallions', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'nori', 'allergens', json_array(), 'removable', json('true'))
    ),
    json_array(
      json_object('name', 'extra noodles', 'priceMinor', 300, 'allergens', json_array('wheat')),
      json_object('name', 'chili oil', 'priceMinor', 100, 'allergens', json_array()),
      json_object('name', 'corn', 'priceMinor', 150, 'allergens', json_array())
    ),
    '["ramen","noodles","fideos","hungry","hambre","dinner","cena","comida"]'),
  ('tr-miso-vegan', 'demo-tsuki-ramen-house', 'Vegan miso ramen', 'meal', 1695, 520, 'USD',
    'vegan', 0,
    json_array(
      json_object(
        'name', 'wheat noodles',
        'allergens', json_array('wheat'),
        'removable', json('false')
      ),
      json_object('name', 'miso broth', 'allergens', json_array('soy'), 'removable', json('false')),
      json_object('name', 'tofu', 'allergens', json_array('soy'), 'removable', json('true')),
      json_object('name', 'bok choy', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'scallions', 'allergens', json_array(), 'removable', json('true')),
      json_object(
        'name', 'peanut chili oil',
        'allergens', json_array('peanuts'),
        'removable', json('true')
      )
    ),
    json_array(
      json_object('name', 'corn', 'priceMinor', 150, 'allergens', json_array()),
      json_object('name', 'extra tofu', 'priceMinor', 250, 'allergens', json_array('soy'))
    ),
    '["ramen","miso","vegan","noodles","fideos","hungry","hambre","dinner","cena","comida"]'),
  ('tr-gyoza', 'demo-tsuki-ramen-house', 'Pork gyoza', 'snack', 895, 280, 'USD', 'any', 0,
    json_array(
      json_object(
        'name', 'wheat wrapper',
        'allergens', json_array('wheat'),
        'removable', json('false')
      ),
      json_object('name', 'pork filling', 'allergens', json_array(), 'removable', json('false')),
      json_object('name', 'cabbage', 'allergens', json_array(), 'removable', json('false')),
      json_object(
        'name', 'soy dipping sauce',
        'allergens', json_array('soy', 'wheat'),
        'removable', json('true')
      )
    ),
    '[]', '["gyoza","dumplings","snack","empanadillas"]'),
  ('tr-cola', 'demo-tsuki-ramen-house', 'Cola', 'drink', 300, 90, 'USD', 'vegan', 0,
    '[{"name":"cola","allergens":[],"removable":false}]', '[]', '["cola","soda","refresco"]'),
  ('tr-lager', 'demo-tsuki-ramen-house', 'Japanese lager', 'drink', 800, 260, 'USD', 'vegan', 1,
    '[{"name":"lager","allergens":[],"removable":false}]', '[]', '["beer","lager","cerveza"]'),
  ('us-smash', 'demo-uptown-smash-co', 'Double smash burger', 'meal', 1450, 480, 'USD', 'any', 0,
    json_array(
      json_object(
        'name', 'brioche bun',
        'allergens', json_array('wheat', 'eggs', 'milk'),
        'removable', json('false')
      ),
      json_object('name', 'beef patties', 'allergens', json_array(), 'removable', json('false')),
      json_object(
        'name', 'american cheese',
        'allergens', json_array('milk'),
        'removable', json('true')
      ),
      json_object('name', 'lettuce', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'pickles', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'onion', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'smash sauce', 'allergens', json_array('eggs'), 'removable', json('true'))
    ),
    json_array(
      json_object('name', 'bacon', 'priceMinor', 250, 'allergens', json_array()),
      json_object('name', 'extra patty', 'priceMinor', 350, 'allergens', json_array())
    ),
    '["burger","hamburguesa","hungry","hambre","lunch","dinner","cena","comida"]'),
  ('us-veggie', 'demo-uptown-smash-co', 'Veggie smash burger', 'meal', 1350, 420, 'USD',
    'vegetarian', 0,
    json_array(
      json_object(
        'name', 'brioche bun',
        'allergens', json_array('wheat', 'eggs', 'milk'),
        'removable', json('false')
      ),
      json_object('name', 'black bean patty', 'allergens', json_array(), 'removable', json('false')),
      json_object(
        'name', 'american cheese',
        'allergens', json_array('milk'),
        'removable', json('true')
      ),
      json_object('name', 'lettuce', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'pickles', 'allergens', json_array(), 'removable', json('true')),
      json_object('name', 'smash sauce', 'allergens', json_array('eggs'), 'removable', json('true'))
    ),
    '[{"name":"avocado","priceMinor":200,"allergens":[]}]',
    json_array(
      'burger',
      'veggie',
      'vegetarian',
      'hamburguesa',
      'hungry',
      'hambre',
      'lunch',
      'dinner',
      'cena',
      'comida'
    )),
  ('us-fries', 'demo-uptown-smash-co', 'Fries', 'snack', 550, 120, 'USD', 'vegan', 0,
    json_array(
      json_object('name', 'potatoes', 'allergens', json_array(), 'removable', json('false')),
      json_object('name', 'sea salt', 'allergens', json_array(), 'removable', json('true'))
    ),
    '[{"name":"cheese sauce","priceMinor":150,"allergens":["milk"]}]',
    '["fries","patatas","snack"]'),
  ('us-cola', 'demo-uptown-smash-co', 'Cola', 'drink', 325, 90, 'USD', 'vegan', 0,
    '[{"name":"cola","allergens":[],"removable":false}]', '[]', '["cola","soda","refresco"]'),
  ('cg-umbrella', 'demo-uptown-corner-goods', 'Compact umbrella', 'goods', 1600, 650, 'USD',
    'any', 0, '[]', '[]', '["umbrella","paraguas","rain","lluvia"]'),
  ('cg-charger', 'demo-uptown-corner-goods', 'USB-C phone charger', 'goods', 1900, 700, 'USD',
    'any', 0, '[]', '[]', '["charger","cargador","phone","battery","bateria"]'),
  ('cg-water', 'demo-uptown-corner-goods', 'Bottled water, 1 litre', 'goods', 250, 70, 'USD',
    'vegan', 0, '[]', '[]', '["water","agua","thirsty","sed"]');

INSERT INTO commerce_agent_rules (merchant_id, rules, updated_at, version) VALUES
  ('demo-morningside-grind',
    json_object(
      'maxDiscountPercent', 25,
      'minMarginPercent', 60,
      'ordersPerQuarterHour', 6,
      'prepMinutes', 5,
      'featuredItemIds', json_array('mg-cold-brew')
    ),
    '2026-11-11T00:00:00.000Z', 1),
  ('demo-amsterdam-bagel-works',
    json_object(
      'maxDiscountPercent', 20,
      'minMarginPercent', 60,
      'ordersPerQuarterHour', 5,
      'prepMinutes', 6,
      'featuredItemIds', json_array()
    ),
    '2026-11-11T00:00:00.000Z', 1),
  ('demo-green-line-poke',
    json_object(
      'maxDiscountPercent', 25,
      'minMarginPercent', 60,
      'ordersPerQuarterHour', 4,
      'prepMinutes', 10,
      'featuredItemIds', json_array('gp-tofu-bowl')
    ),
    '2026-11-11T00:00:00.000Z', 1),
  ('demo-tsuki-ramen-house',
    json_object(
      'maxDiscountPercent', 25,
      'minMarginPercent', 60,
      'ordersPerQuarterHour', 4,
      'prepMinutes', 15,
      'featuredItemIds', json_array('tr-miso-vegan')
    ),
    '2026-11-11T00:00:00.000Z', 1),
  ('demo-uptown-smash-co',
    json_object(
      'maxDiscountPercent', 30,
      'minMarginPercent', 60,
      'ordersPerQuarterHour', 5,
      'prepMinutes', 12,
      'featuredItemIds', json_array()
    ),
    '2026-11-11T00:00:00.000Z', 1),
  ('demo-uptown-corner-goods',
    json_object(
      'maxDiscountPercent', 20,
      'minMarginPercent', 40,
      'ordersPerQuarterHour', 10,
      'prepMinutes', 3,
      'featuredItemIds', json_array()
    ),
    '2026-11-11T00:00:00.000Z', 1);
