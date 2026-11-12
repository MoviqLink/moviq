-- What the nightly process measures of buses from their GPS reports, by New York day. Each row
-- counts its measures in steps (`counts`, `[value, how many]` sorted as JSON), so days add up
-- exactly; nothing is kept point by point.

-- The speed of buses on a stretch of street (`recorder/nightly/stretch-speeds.ts`): a square of
-- 250 m crossed in one of four headings, keyed `x:y:heading`. Metres a second, in steps of 0.5.
-- Some hundred thousand rows a day: kept once, in the order the estimator reads them (a day is
-- replaced by a scan, once a night).
CREATE TABLE recorder_stretch_speeds (
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  route TEXT NOT NULL,
  stretch TEXT NOT NULL,
  band TEXT NOT NULL,
  day_type TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n > 0),
  counts TEXT NOT NULL,
  PRIMARY KEY (route, stretch, band, mode, day)
) STRICT, WITHOUT ROWID;

-- How far the estimator's `gps-plus` position was from the next GPS report, replayed
-- (`recorder/nightly/tracking-errors.ts`), by route and band of seconds since the last report.
-- Metres, rounded up in steps of 5.
CREATE TABLE recorder_tracking_errors (
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  route TEXT NOT NULL,
  age_from INTEGER NOT NULL CHECK (age_from >= 0),
  age_to INTEGER NOT NULL CHECK (age_to > age_from),
  n INTEGER NOT NULL CHECK (n > 0),
  counts TEXT NOT NULL,
  PRIMARY KEY (day, mode, route, age_from)
) STRICT;
