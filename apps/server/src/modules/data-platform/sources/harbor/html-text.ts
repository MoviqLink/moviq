/** The named character references these providers use; any other is left as written. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  hellip: '…',
};

function codePoint(value: number, written: string): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : written;
}

/** HTML character references (`&quot;`, `&#39;`, `&#x2019;`) as the characters they stand for. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (written, name: string) => {
    if (/^#x/i.test(name)) return codePoint(Number.parseInt(name.slice(2), 16), written);
    if (name.startsWith('#')) return codePoint(Number(name.slice(1)), written);
    return NAMED[name.toLowerCase()] ?? written;
  });
}

/** The text of an HTML fragment, one line per paragraph or line break, without empty lines. */
export function htmlLines(html: string): string[] {
  return decodeEntities(html.replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}
