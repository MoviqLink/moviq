# Intro

The opening moment approved by Manu (idea 53): on black the ring draws itself and MOVIQ appears,
"Move smarter." is typed with a square cursor that blinks three times and goes out, New York rises
slowly out of the dark, and then the header and Sara's question arrive. Everything happens once.

- `once.ts`: it plays once per browser session, only when MovIQ opens at `#/` and never with
  `prefers-reduced-motion`; the first address of the load decides.
- `timeline.ts`: the beats in milliseconds.
- `Intro.tsx`: the overlay. A key, a click or a tap skips it; it is hidden from assistive
  technology, which reads the page underneath from the first moment.
- `intro.css`: the drawing, the typing and the three blinks.
