import type { Journey } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { changeKey, needsWords, saraWords, unreached } from '../src/features/trip/model/sara';
import { saraEn, saraEs } from '../src/features/trip/sara-texts';
import { journey } from './fixtures/journeys';

const NOW = Date.parse('2026-11-11T20:00:00.000Z');

type Written = Extract<NonNullable<Journey['watch']['explanation']>, { mode: 'ai' }>;

const WORDS: Written = {
  mode: 'ai',
  about: 'at-risk|traffic|Q70',
  lang: 'es',
  text: 'El M60 va lento por el tráfico; te recomiendo el Q70, que llega antes.',
  writtenAt: '2026-11-11T19:59:00.000Z',
  sources: [{ sourceId: 'mta-bus-time', dataTime: '2026-11-11T19:58:50.000Z' }],
};

const withWords = (base: Journey, explanation: Journey['watch']['explanation']): Journey => ({
  ...base,
  watch: { ...base.watch, explanation },
});

describe("Sara's words on the trip card", () => {
  it('says she is watching when nothing changed, and asks for no words', () => {
    const calm = journey(NOW, 'en', false);
    expect(saraWords(calm, 'en')).toEqual({ kind: 'quiet' });
    expect(needsWords(calm, 'en')).toBe(false);
  });

  it('waits for her words on a change, and asks for them in the traveller language', () => {
    const risky = journey(NOW, 'es', true);
    expect(saraWords(risky, 'es')).toEqual({ kind: 'writing' });
    expect(needsWords(risky, 'es')).toBe(true);
  });

  it('shows the words of the model with their sources once they are in the journey', () => {
    const risky = withWords(journey(NOW, 'es', true), WORDS);
    expect(saraWords(risky, 'es')).toEqual({
      kind: 'ai',
      about: WORDS.about,
      lang: 'es',
      text: WORDS.text,
      writtenAt: WORDS.writtenAt,
      sources: WORDS.sources,
    });
    expect(needsWords(risky, 'es')).toBe(false);
    // Words in another language are asked for again in this one.
    expect(saraWords(risky, 'en')).toEqual({ kind: 'writing' });
    expect(needsWords(risky, 'en')).toBe(true);
  });

  it('without words of hers, gives the watch’s own sentence and the reason', () => {
    const base = journey(NOW, 'en', true);
    const basic = withWords(base, { mode: 'basic', about: 'x', lang: 'en', reason: 'budget' });
    expect(saraWords(basic, 'en')).toEqual({
      kind: 'basic',
      reason: 'budget',
      evidence: base.watch.evidence,
    });
    expect(unreached(base)).toEqual({
      kind: 'basic',
      reason: 'unreached',
      evidence: base.watch.evidence,
    });
  });

  it('asks once per change: the key moves with the verdict, incidents, options and language', () => {
    const risky = journey(NOW, 'en', true);
    const same = { ...risky, watch: { ...risky.watch, evidence: 'Arriving about 18:53.' } };
    expect(changeKey(same, 'en')).toBe(changeKey(risky, 'en'));
    expect(changeKey({ ...risky, alternatives: [] }, 'en')).not.toBe(changeKey(risky, 'en'));
    expect(changeKey(risky, 'es')).not.toBe(changeKey(risky, 'en'));
  });

  it('names every reason in English and Spanish, never as a plain "basic mode"', () => {
    expect(Object.keys(saraEs.basic)).toEqual(Object.keys(saraEn.basic));
    for (const line of [...Object.values(saraEn.basic), ...Object.values(saraEs.basic)]) {
      expect(line).not.toMatch(/basic mode|modo básico/i);
    }
  });
});
