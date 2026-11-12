# Agent

The traveller talks to Sara in one stored conversation: where they are going, when and which
stops they need. Suggestions send a ready question; answers keep their line breaks and list the
sources behind them. Beside the chat, «What Sara can do for you» holds the PayPal permission: the
traveller lets Sara buy tickets (on by default), approves once in PayPal and can disconnect;
PayPal returns to `#/agents?autopay=connected|failed`, shown once. «Sara watches for you» is a
full-width strip under the chat: add a line (quick badges or any MTA or PATH name) or a measured
street, see each watch as a card with its state and last check, and read the notices newest
first; the honest notes sit together at its foot. The server checks real MTA and PATH alerts; a source failure is never
reported as clear. Road watches select a measured NYC DOT segment and an explicit speed
threshold. They alert only after a below-threshold baseline and two distinct fresh readings
above it; unavailable or stale data never proves improvement.
