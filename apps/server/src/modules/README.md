# Modules

Each module owns one area of the product and exposes routes, services and repositories for it.

| Module           | Area                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `assistant/`     | Sara: the planning conversation, its basic mode, budget and privacy                                             |
| `city-layers/`   | Explore's city layers: 511NY, street, parking, places, the harbour, weather; camera pictures through the server |
| `airports/`      | JFK, LaGuardia and Newark boards: AeroDataBox, ADS-B, the FAA, next departures                                  |
| `data-platform/` | Sources: collection, validation, states, rhythms and serving                                                    |
| `events/`        | Events across New York from every source, merged only by place and start, with official links                   |
| `identity/`      | Who is acting: travellers' device sessions, control room sessions and roles                                     |
| `live/`          | Explore: every vehicle that can be followed, by mode                                                            |
| `journeys/`      | Backward planning, watched journeys, alternatives and what they sell                                            |
| `operations/`    | Health, the hosting probe and the control room API                                                              |
| `payments/`      | PayPal orders, the payment ledger, webhooks and reconciliation                                                  |
| `recorder/`      | The recorder of every live source and its nightly statistics                                                    |
