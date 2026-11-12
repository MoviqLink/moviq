# Explore events

The events layer of Explore: `GET /api/events` for today, tonight or this weekend (New York
time), drawn on the map and listed in the panel with a filter by kind, and the card of an event.
It reads every five minutes; nothing moves while it waits.

| Folder or file           | Contents                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| `api.ts`                 | `/api/events` for a window of time                                     |
| `useEvents.ts`           | The layer: on or off, the window, the kind, the last good answer       |
| `model/`                 | The windows, the link to planning with Sara and the rules of the panel |
| `ui/`                    | `EventsPanel` in the overview and `EventCard`                          |
| `texts-*.ts`, `texts.ts` | English and Spanish words, with the same keys                          |
| `events.css`             | The styles of the layer only                                           |

The card shows the start and the end (or that the source gives none), the venue, every source
with the age of its listing, the official page in a new tab (`rel="noopener noreferrer"`) and
"How to get there on time", which opens `#/plan?to=&lat=&lon=&arriveBy=&event=`. MovIQ sells
nothing here: no payment, no booking, and no word about price, which no source gives.

Tourist mode opens this layer alongside the NYC LPC designated-landmarks layer. Landmark status
does not imply public access or visiting hours; tourist experiences are not yet available.
