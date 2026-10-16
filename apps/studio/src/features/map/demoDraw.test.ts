import { describe, expect, it, vi } from 'vitest';
import type { SceneEngine } from '@ulpin/scene';
import type { AreaFeature } from '../../api/queries';
import context from '../../local/data/nyc-bronx-context.json';
import { acknowledgeDemoPart, attachDemoScene } from '../../api/demo-import';

const features = context.features as unknown as AreaFeature[];

describe('part acknowledgement from rendered scene progress', () => {
  it('waits for the engine to draw all buildings and base features in a part', async () => {
    let drawn = 0;
    let finish!: (result: boolean) => void;
    const waitForDrawn = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const detach = attachDemoScene('area', { waitForDrawn } as unknown as SceneEngine);
    const ack = vi.fn(() => expect(drawn).toBe(features.filter((feature) => feature.kind === 'building').length));
    const waiting = acknowledgeDemoPart('area', features, new AbortController().signal, ack);
    await Promise.resolve();
    expect(ack).not.toHaveBeenCalled();
    expect(waitForDrawn).toHaveBeenCalledWith(
      features.filter((feature) => feature.kind === 'building').map((feature) => feature.id),
      features.filter((feature) => feature.kind !== 'building').map((feature) => feature.id),
      expect.any(AbortSignal),
    );
    drawn = features.filter((feature) => feature.kind === 'building').length;
    finish(true);
    await waiting;
    expect(ack).toHaveBeenCalledOnce();
    detach();
  });

  it('acknowledges immediately when the part has no drawable features', async () => {
    const ack = vi.fn();
    await acknowledgeDemoPart('empty', [], new AbortController().signal, ack);
    expect(ack).toHaveBeenCalledOnce();
  });

  it('retains an early part until its map engine mounts', async () => {
    const ack = vi.fn();
    const waiting = acknowledgeDemoPart('early', features, new AbortController().signal, ack);
    await Promise.resolve();
    expect(ack).not.toHaveBeenCalled();
    const waitForDrawn = vi.fn(async () => true);
    const detach = attachDemoScene('early', { waitForDrawn } as unknown as SceneEngine);
    await waiting;
    expect(ack).toHaveBeenCalledOnce();
    detach();
  });

  it('does not acknowledge an unmounted map or a disposed engine', async () => {
    const ack = vi.fn();
    const controller = new AbortController();
    const waiting = acknowledgeDemoPart('missing', features, controller.signal, ack);
    controller.abort();
    await waiting;
    const detach = attachDemoScene('disposed', {
      waitForDrawn: async () => false,
    } as unknown as SceneEngine);
    await acknowledgeDemoPart('disposed', features, new AbortController().signal, ack);
    expect(ack).not.toHaveBeenCalled();
    detach();
  });
});
