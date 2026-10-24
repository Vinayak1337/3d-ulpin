import { describe, expect, it } from 'vitest';
import { imageryVisibility } from './useMapView';

describe('imagery choice', () => {
  it('defaults listed pictures on, never an aerial alongside them', () => {
    expect(imageryVisibility(null, true)).toEqual({ retained: true, aerial: false });
  });

  it('defaults nothing on when only a supplemental aerial is available', () => {
    expect(imageryVisibility(null, false)).toEqual({ retained: false, aerial: false });
  });

  it('shows both kinds only when the viewer chooses on', () => {
    expect(imageryVisibility(true, true)).toEqual({ retained: true, aerial: true });
    expect(imageryVisibility(true, false)).toEqual({ retained: true, aerial: true });
  });

  it('hides both kinds when the viewer chooses off', () => {
    expect(imageryVisibility(false, true)).toEqual({ retained: false, aerial: false });
    expect(imageryVisibility(false, false)).toEqual({ retained: false, aerial: false });
  });
});
