import { describe, expect, it, vi } from 'vitest';

import { showView } from '../../src/features/explore/map/basemap';

describe('map views', () => {
  it('changes only layer visibility, preserving the entire camera', () => {
    const camera = { center: [-73.98, 40.75], zoom: 14, pitch: 35, bearing: 18, padding: 100 };
    const stubMap = {
      setLayoutProperty: vi.fn(),
      easeTo: vi.fn(),
      camera,
    };
    for (const view of ['2d', 'photo'] as const) showView(stubMap, view);
    expect(stubMap.setLayoutProperty.mock.calls).toEqual([
      ['explore-aerial', 'visibility', 'none'],
      ['explore-aerial-detail', 'visibility', 'none'],
      ['explore-aerial', 'visibility', 'visible'],
      ['explore-aerial-detail', 'visibility', 'visible'],
    ]);
    expect(stubMap.easeTo).not.toHaveBeenCalled();
    expect(stubMap.camera).toEqual({
      center: [-73.98, 40.75],
      zoom: 14,
      pitch: 35,
      bearing: 18,
      padding: 100,
    });
  });
});
