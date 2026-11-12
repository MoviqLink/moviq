import { assistantTurnSchema, type CitySource } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { reduceConversation, emptyConversation } from '../src/features/plan/model/conversation';
import { sourceNotes } from '../src/features/plan/model/city';
import { planEn, planEs } from '../src/features/plan/texts';
import { cityTurn } from './fixtures/city';

const now = Date.parse('2026-11-11T12:00:00.000Z');

const source = (state: CitySource['state'], dataTime: string | null): CitySource => ({
  sourceId: 'mta-alerts',
  title: 'MTA service alerts',
  dataTime,
  ageSeconds: dataTime === null ? null : 60,
  state,
});

describe("Sara's answers about the city", () => {
  it('fit the contract in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      expect(assistantTurnSchema.parse(cityTurn(now, lang)).city).toHaveLength(2);
    }
  });

  it('stay with the words of the turn that found them', () => {
    const turn = cityTurn(now, 'es');
    const sent = reduceConversation(emptyConversation, { type: 'sent', message: '¿Cómo va la A?' });
    const answered = reduceConversation(sent, { type: 'answered', turn });
    const [, sara] = answered.entries;
    expect(sara).toMatchObject({ from: 'sara', city: turn.city });
  });

  it('say the time of the data of each source, in New York time', () => {
    const [note] = sourceNotes(
      [source('healthy', '2026-11-11T11:59:00.000Z')],
      planEn.city,
      'en-US',
    );
    expect(note).toMatchObject({ when: 'data of 6:59 AM', usable: true });
    const [nota] = sourceNotes(
      [source('degraded', '2026-11-11T11:59:00.000Z')],
      planEs.city,
      'es-ES',
    );
    expect(nota).toMatchObject({ when: 'datos de las 6:59', usable: true });
  });

  it('never give a time for a source that could not be read or is too old', () => {
    const notes = sourceNotes(
      [source('unavailable', null), source('stale', '2026-11-11T11:00:00.000Z')],
      planEn.city,
      'en-US',
    );
    expect(notes.map((note) => [note.when, note.usable])).toEqual([
      ['not available now', false],
      ['too old to rely on', false],
    ]);
  });
});
