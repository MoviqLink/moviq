import { describe, expect, it } from 'vitest';

import { readCityQuestion } from '../../src/modules/assistant/understanding/city-question.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const read = (text: string) => readCityQuestion(text, NOW);

describe('the basic reader of city questions, in English and Spanish', () => {
  it.each([
    ['¿Cómo va la línea A?', { tool: 'line-status', route: { ids: ['A'] } }],
    ['How is the A doing?', { tool: 'line-status', route: { ids: ['A'] } }],
    ['¿Cómo está el PATH?', { tool: 'line-status', route: { mode: 'path', label: 'PATH' } }],
    ["How's the M15 SBS?", { tool: 'line-status', route: { ids: ['M15+'], label: 'M15-SBS' } }],
    [
      '¿Hay incidencias en el 7?',
      { tool: 'incidents', scope: { scope: 'line', route: { ids: ['7'] } } },
    ],
    ['¿Hay avisos en el ferri?', { tool: 'incidents', scope: { scope: 'mode', mode: 'ferry' } }],
    ['Any delays on the subway?', { tool: 'incidents', scope: { scope: 'mode', mode: 'subway' } }],
    ['Any problems on my trip?', { tool: 'incidents', scope: { scope: 'trip' } }],
    [
      '¿Hay problemas en Jay St-MetroTech?',
      { tool: 'incidents', scope: { scope: 'station', station: 'Jay St-MetroTech' } },
    ],
    ['Where is my bus?', { tool: 'where-is', asked: { by: 'trip' } }],
    ['¿Dónde está el autobús 7652?', { tool: 'where-is', asked: { by: 'vehicle', name: '7652' } }],
    [
      'Where is the A to Far Rockaway?',
      { tool: 'where-is', asked: { by: 'route', towards: 'Far Rockaway' } },
    ],
    ['¿Funciona el ascensor de 59 St?', { tool: 'station-access', station: '59 St' }],
    [
      'Is the elevator at Times Sq-42 St working?',
      { tool: 'station-access', station: 'Times Sq-42 St' },
    ],
    ['¿Suele ir bien la línea 7 a esta hora?', { tool: 'line-reliability', route: { ids: ['7'] } }],
    [
      'Is the Bx12 usually on time?',
      { tool: 'line-reliability', route: { ids: ['BX12'], label: 'Bx12' } },
    ],
  ])('%s', (sentence, expected) => {
    expect(read(sentence)).toMatchObject(expected);
  });

  it.each([
    'Bryant Park at 7 pm from 125th Street',
    'Tengo que estar en Penn Station a las 9',
    'a las 7 de la tarde',
    'the second one',
    'How is the weather?',
  ])('leaves "%s" to the trip planner', (sentence) => {
    expect(read(sentence)).toBeUndefined();
  });
});
