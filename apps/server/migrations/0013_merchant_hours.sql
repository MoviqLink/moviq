-- The opening hours of each demo merchant become part of what "Your agent" edits: up to three
-- stretches a day, New York wall clock, saved with the rules and under their version. The single
-- daily range seeded in 0010 becomes the same stretch every day of the week, and is then dropped
-- from the merchant, so the hours have one home.
ALTER TABLE commerce_agent_rules
  ADD COLUMN hours TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(hours));

UPDATE commerce_agent_rules
SET hours = (
  SELECT json_object(
    'mon', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at)),
    'tue', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at)),
    'wed', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at)),
    'thu', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at)),
    'fri', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at)),
    'sat', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at)),
    'sun', json_array(json_object('opens', m.opens_at, 'closes', m.closes_at))
  )
  FROM commerce_merchants m
  WHERE m.id = commerce_agent_rules.merchant_id
);

ALTER TABLE commerce_merchants DROP COLUMN opens_at;
ALTER TABLE commerce_merchants DROP COLUMN closes_at;
