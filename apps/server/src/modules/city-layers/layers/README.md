# City layers

One file per group of Explore's city layers. Each reads its sources through the data platform and
returns items with their source, time and attribution; none of them asks a provider directly.

| File             | Layers                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `road-events.ts` | 511NY incidents, closures and construction                                                               |
| `street.ts`      | NYC closures and permitted events today, street permits (never shown as closures), 511NY cameras         |
| `places.ts`      | EV chargers, defibrillators, public restrooms, designated landmarks, subway entrances and parking meters |
| `harbor.ts`      | PNCT vessel calls, NOAA PORTS readings and Coast Guard notices                                           |
| `transit.ts`     | Transit alerts of 511NY, PATH and the ferries                                                            |
| `weather.ts`     | Road conditions and weather warnings                                                                     |
