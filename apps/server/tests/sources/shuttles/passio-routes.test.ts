import { describe, expect, it } from 'vitest';
import { passioRouteSource } from '../../../src/modules/data-platform/sources/shuttles/passio-routes.js';
import { decodePolyline } from '../../../src/modules/data-platform/sources/mta/polyline.js';
import { accepted, capture } from '../regional/captures.js';

const context = { receivedAt: new Date('2026-11-11T03:20:10Z'), previous: undefined };

describe('Passio GO published route shapes', () => {
  it('reads the published shapes for the active routes in the capture', () => {
    const result = accepted(
      passioRouteSource.parse(capture('shuttles', 'passio-go-routes.json'), context),
    );
    const data = passioRouteSource.dataSchema.parse(result.data);
    for (const id of ['74769', '75154', '74770', '74768', '6255', '72705']) {
      const route = data[id];
      expect(
        decodePolyline(typeof route === 'string' ? route : (route?.shape ?? ''))?.length,
      ).toBeGreaterThan(1);
    }
  });
  it('continues to read the previous stored schema and requests a full refresh', () => {
    const old = passioRouteSource.dataSchema.parse({ '1': 'abc' });
    expect(old['1']).toBe('abc');
    expect(passioRouteSource.needsFullRefresh?.(old)).toBe(true);
  });
  it('refuses malformed or disconnected geometry rather than drawing bridges', () => {
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const pt = { lat: '40.7', lng: '-74.0' };
    expect(
      passioRouteSource.parse(
        json({
          routes: { x: ['X', 'black', 0] },
          routePoints: {
            x: [
              [pt, pt],
              [pt, pt],
            ],
          },
        }),
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(
      passioRouteSource.parse(
        json({ routes: { x: ['X', 'black', '1'] }, routePoints: { x: [[pt, pt]] } }),
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(passioRouteSource.parse(json({ routes: {}, routePoints: {} }), context)).toMatchObject({
      ok: false,
    });
  });
});
