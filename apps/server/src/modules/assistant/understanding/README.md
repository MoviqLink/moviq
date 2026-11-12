# Understanding

The basic reader, used without a model: it turns one sentence in English or Spanish into the
parts of a trip and leaves unknown parts empty.

- `reader.ts`: destination, start and plain answers between markers ("from", "to", "desde",
  "voy a", "salgo de"…), airports, and a choice among the places offered ("the second one").
- `time-words.ts`: times and days, always in New York time. An hour that could be morning or
  evening ("at 7", "a las 7") is returned as ambiguous so Sara asks; a time already past is
  reported, never moved to another day.
- `flight-number.ts`: flight numbers in any common spelling. Without "flight" or "vuelo", only the
  codes of airlines flying from New York count, so bus routes ("M60") are never flights. Also the
  terminal of a boarding pass ("terminal 4", "T8"; letters in capitals only).

- `city-question.ts`: questions about the city ("how is the A?", "¿hay avisos en el ferri?",
  "where is my bus?", "¿funciona el ascensor de 59 St?", "is the 7 usually on time?"). A letter
  or digit counts as a line only after "the", "la", "línea"…, so "a las 7" is never the A or the 7;
  anything else is left to the trip planner.

- `craving.ts`: something fancied on the way ("I'm craving ramen", "me apetece un café con leche
  de avena"); only those openings count, so "I want to know…" or "quiero saber…" stays a question.

Tested in `tests/assistant/reader.test.ts`, `city-reader.test.ts` and `trip-rewards.test.ts`.
