/**
 * Something the traveller fancies on the way, as people say it in English or Spanish: "I'm
 * craving ramen", "I'd like an oat milk latte", "me apetece un café con leche de avena", "quiero
 * ramen". Only these openings count, so a question about the trip or the city ("I want to know
 * if the A runs", "quiero saber si llego") is never taken for a craving.
 */
const OPENINGS = [
  /^(?:i(?:'m| am) (?:craving|hungry for|in the mood for)|i(?:'d| would) (?:like|love))\s+(.+)$/iu,
  /^(?:i want|i fancy|craving|can i (?:get|have))\s+(.+)$/iu,
  /^(?:me apetece|me apetecería|me encantaría|quiero|quisiera|se me antoja|tengo antojo de|tengo ganas de)\s+(.+)$/iu,
];

/** A question or a plan, not something to eat, drink or buy. */
const NOT_A_CRAVING =
  /^(?:to|know|go|get to|arrive|change|switch|saber|ir|llegar|cambiar|ver|que|si|if|a taxi|un taxi)(?![\p{L}])/iu;

/** The article in front of the craving, which the merchant does not need. */
const ARTICLE = /^(?:some|an?|the|un|una|unos|unas|algo de)\s+/iu;

const MIN = 2;
const MAX = 80;

/** The craving in the sentence, as the merchants will read it, or undefined when there is none. */
export function readCraving(text: string): string | undefined {
  const words = text
    .trim()
    .replace(/^(?:sara[,:]?\s+)/iu, '')
    .replace(/^[¿¡\s]+|[?!.\s]+$/gu, '')
    .replace(/[’]/gu, "'");
  for (const opening of OPENINGS) {
    const said = opening.exec(words)?.[1]?.trim();
    if (said === undefined || NOT_A_CRAVING.test(said)) continue;
    const craving = said
      .replace(ARTICLE, '')
      .replace(/,?\s*(?:please|por favor)$/iu, '')
      .trim();
    if (craving.length >= MIN && craving.length <= MAX) return craving;
  }
  return undefined;
}
