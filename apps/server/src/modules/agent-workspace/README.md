# Agent workspace

Traveller-owned agents and separate conversations, plus worker-run watches for MTA subway/bus
and PATH alerts. A fresh source must report an alert and later report none before a cleared
notification is recorded; unavailable readings never count as clear. Messages are scrubbed of
personal details before persistence and Sara receives only the scrubbed text. Alerts are in-app.

NYC DOT road watches use segment IDs and user-selected speed thresholds, require two distinct
fresh readings after a below-threshold baseline, and preserve generation/leadership fencing.
Notifications describe measured speed, never a guarantee that a street is clear.
