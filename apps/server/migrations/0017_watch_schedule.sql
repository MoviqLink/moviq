-- Bound scheduling work without scanning paused watches or sorting the full watch history.
CREATE INDEX workspace_watches_schedule
ON workspace_watches(kind, checked_at, created_at, id)
WHERE status != 'paused';
