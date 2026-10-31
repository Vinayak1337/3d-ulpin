import { describe, expect, it, vi } from 'vitest';
import type { SurfacePartInput } from '@ulpin/scene';
import { decodePart, type DecodeReply } from './decode';
import { SHADED, SURFACE_LIMITS, SurfaceParts, type IntakeItem, type PartDisplay, type PartPage, type SurfaceIo,
  type SurfaceLine } from './parts';

const OUTSIDE = 'Read, outside this area: its corners do not meet the batch area\'s extent.';
const corners = [[0, 10], [10, 10], [10, 0], [0, 0]];

function item(partsDone: number, state = 'reading', tray: Partial<IntakeItem> = {}): IntakeItem {
  return { itemId: 'i-1', caseId: 'c-1', sourceId: 's-1', name: 'nyc-10013-dem-2017.tif', family: 'raster', state,
    partsDone, limitReason: null, ...tray } as unknown as IntakeItem;
}

/** Answers the reads as the server would for `published` parts; records what was asked and how many at once. */
function fakeIo(published: () => number, display: (partIndex: number) => Partial<PartDisplay> | Error,
  decoded: (partIndex: number) => DecodeReply = () => ({ kind: 'raster', picture: {
    width: 1, height: 1, rgba: new Uint8ClampedArray(4), shading: 'own_range', range: [1, 2], note: null } })) {
  const asked: number[] = [];
  let inFlight = 0, most = 0;
  const io: SurfaceIo = {
    page: async (_item, after) => {
      const parts = Array.from({ length: published() }, (_, partIndex) => ({ partIndex, state: 'published' }))
        .filter((part) => part.partIndex > after).slice(0, 64);
      const last = parts[parts.length - 1]?.partIndex;
      return { parts, next: last !== undefined && last < published() - 1 ? last : null } as unknown as PartPage;
    },
    display: async (_item, partIndex) => {
      asked.push(partIndex);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      const answer = display(partIndex);
      if (answer instanceof Error) throw answer;
      return { partIndex, artifact: { mediaType: 'image/tiff' }, ...answer } as PartDisplay;
    },
    artifact: async (part) => new ArrayBuffer(part.partIndex + 1), // the length names the part to the decoder
    decode: async (request) => decoded(request.bytes.byteLength - 1),
    canvas: () => ({}) as HTMLCanvasElement,
  };
  return { io, asked, most: () => most };
}

const placed = { placement: { state: 'placed', corners } } as unknown as Partial<PartDisplay>;
const outside = { placement: { state: 'not_placed', reason: 'outside_area', words: OUTSIDE } } as Partial<PartDisplay>;

function layer(io: SurfaceIo) {
  const view: { parts: SurfacePartInput[]; lines: SurfaceLine[] } = { parts: [], lines: [] };
  const parts = new SurfaceParts(io, (drawn, lines) => { view.parts = drawn; view.lines = lines; });
  return { parts, view };
}

describe('the read parts of a batch\'s kept surfaces', () => {
  it('keeps drawing the read parts when the item reports preparing', async () => {
    const fake = fakeIo(() => 1, () => placed);
    const { parts, view } = layer(fake.io);
    parts.sync([item(1, 'preparing')]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(1));
    expect(fake.asked).toEqual([0]);
    parts.dispose();
  });

  it('passes a native LAS stride from the accepted artifact and batch to the map decoder', async () => {
    const valueRange = { kind: 'z' as const, low: 0, high: 100, basis: 'test_only LAS header control' };
    const fake = fakeIo(() => 1, () => ({ ...placed, valueRange,
      artifact: { mediaType: 'application/vnd.las.point-records', bytes: 56 },
      read: { operation: 'point-batch', batch: { start: 0, count: 2 } },
    } as PartDisplay));
    const records = new DataView(new ArrayBuffer(56));
    records.setInt32(28, 100, true);
    records.setInt32(32, 100, true);
    fake.io.artifact = async () => records.buffer;
    fake.io.decode = vi.fn(async request => decodePart(request));
    const { parts, view } = layer(fake.io);
    parts.sync([item(1, 'read', { family: 'point_cloud', name: 'literal.las' })]);
    await vi.waitFor(() => expect(view.parts[0]?.points).toBeDefined());
    expect(fake.io.decode).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'points', recordLength: 28, valueRange }), expect.any(AbortSignal));
    expect(Array.from(view.parts[0]!.points!.positions)).toEqual([0, 0, 0, 10, 10, 0]);
  });

  it('marks only a multi-part overview under its tiles and passes the item range to decoding', async () => {
    const valueRange = { kind: 'band' as const, low: 0, high: 100, basis: 'test_only overview control' };
    let published = 1;
    const fake = fakeIo(() => published, () => ({ ...placed, valueRange }));
    fake.io.decode = vi.fn(fake.io.decode);
    const { parts, view } = layer(fake.io);
    parts.sync([item(1, 'reading', { partsPlanned: 2 })]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(1));
    expect(view.parts[0]!.under).toBe(true);
    published = 2;
    parts.sync([item(2, 'read', { partsPlanned: 2 })]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(2));
    expect(view.parts.map(p => p.under)).toEqual([true, false]);
    expect(fake.io.decode).toHaveBeenCalledWith(expect.objectContaining({ valueRange }), expect.any(AbortSignal));
    parts.dispose();
    const single = layer(fakeIo(() => 1, () => placed).io);
    single.parts.sync([item(1, 'read', { partsPlanned: 1 })]);
    await vi.waitFor(() => expect(single.view.parts).toHaveLength(1));
    expect(single.view.parts[0]!.under).toBe(false);
    single.parts.dispose();
  });

  it('counts a part not placed in the placement\'s own words and never draws it', async () => {
    const { io } = fakeIo(() => 3, (n) => (n === 1 ? outside : placed));
    const { parts, view } = layer(io);
    parts.sync([item(3, 'read')]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(2));
    await vi.waitFor(() => expect(view.lines[0]!.line).toContain('1 not placed'));
    expect(view.parts.map((part) => part.id)).toEqual(['i-1:0', 'i-1:2']);
    expect(view.parts[0]!.corners).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]); // SW, SE, NE, NW
    expect(view.lines[0]!.line).toBe('2 parts drawn and 1 not placed, of 3 read parts. '
      + `Not placed: 1 part: ${OUTSIDE} ${SHADED}`);
  });

  it('draws at most 256 parts of one file, says which, and keeps at most 4 display reads in flight', async () => {
    const fake = fakeIo(() => 300, () => placed);
    const { parts, view } = layer(fake.io);
    parts.sync([item(300, 'read')]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(SURFACE_LIMITS.drawnPerItem), { timeout: 5000 });
    expect(fake.asked).toHaveLength(256);
    expect(fake.most()).toBe(SURFACE_LIMITS.displayReads);
    expect(view.lines[0]!.line).toContain('First 256 parts shown (0 to 255); 44 later parts not drawn.');
  });

  it('draws new parts as the stream reports them, without reading drawn parts again', async () => {
    let published = 2;
    const fake = fakeIo(() => published, () => placed);
    const { parts, view } = layer(fake.io);
    parts.sync([item(2)]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(2));
    published = 5;
    parts.sync([item(5)]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(5));
    expect(fake.asked).toEqual([0, 1, 2, 3, 4]);
  });

  it('names a failed read on its line, leaves the rest drawn and draws refused content as an outline', async () => {
    const fake = fakeIo(() => 3, (n) => (n === 0 ? new Error('This part was read under an older batch context.')
      : placed), (n) => (n === 2 ? { refusal: 'This part is tiled; the map reads only the reader\'s own strips.' }
      : { kind: 'points', positions: new Float32Array(3), colors: new Float32Array(3), sizeM: 1 }));
    const { parts, view } = layer(fake.io);
    parts.sync([item(3, 'read')]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(2));
    await vi.waitFor(() => expect(view.lines[0]!.line).toContain('Outline only'));
    const line = view.lines[0]!.line;
    expect(line).toContain('Not read for the map: 1 part: This part was read under an older batch context.');
    expect(line).toContain('Outline only: 1 part: This part is tiled; the map reads only the reader\'s own strips.');
    expect(view.parts.find((part) => part.id === 'i-1:2')).toMatchObject({ corners: expect.any(Array) });
    expect(view.parts.find((part) => part.id === 'i-1:2')!.points).toBeUndefined();
    expect(view.parts.find((part) => part.id === 'i-1:1')!.points).toBeDefined();
  });

  const NO_EXTENT = 'Read but not placed: the batch area has no extent yet.';
  const waiting = { placement: 'waiting_for_anchor', limitReason: `Read 3 of 3 windows. ${NO_EXTENT}` } as const;
  const onMap = { placement: 'on_map', limitReason: 'Read 3 of 3 windows. Placed against the extent of this '
    + 'batch\'s drafted footprints; the area has no recorded extent yet.' } as const;

  it('draws the parts held as not placed once the stream reports the file placed, without a reload', async () => {
    let extent = false;
    const noExtent = { placement: { state: 'not_placed', reason: 'no_area_extent', words: NO_EXTENT } };
    const fake = fakeIo(() => 3, () => (extent ? placed : noExtent as Partial<PartDisplay>));
    const { parts, view } = layer(fake.io);
    parts.sync([item(3, 'read', waiting)]);
    await vi.waitFor(() => expect(view.lines[0]!.line).toContain('0 parts drawn and 3 not placed'));
    expect(view.parts).toHaveLength(0);
    // The batch's footprints are drafted: the server settles the file on the map and the stream reports it.
    extent = true;
    parts.sync([item(3, 'read', onMap)]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(3));
    await vi.waitFor(() => expect(view.lines[0]!.line).toContain('3 parts drawn and 0 not placed'));
    expect(view.lines[0]!.line).not.toContain('Not placed:');
    expect(fake.asked).toEqual([0, 1, 2, 0, 1, 2]);
    // The same report again asks nothing.
    parts.sync([item(3, 'read', onMap)]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.asked).toHaveLength(6);
  });

  it('asks the parts held as not placed again inside the same bounds: 4 in flight, 256 per file', async () => {
    let extent = false;
    const noExtent = { placement: { state: 'not_placed', reason: 'no_area_extent', words: NO_EXTENT } };
    const fake = fakeIo(() => 300, () => (extent ? placed : noExtent as Partial<PartDisplay>));
    const { parts, view } = layer(fake.io);
    vi.useFakeTimers();
    try {
      parts.sync([item(300, 'read', waiting)]);
      await vi.runAllTimersAsync();
      expect(view.lines[0]!.line).toContain('0 parts drawn and 256 not placed');
      expect(fake.asked).toHaveLength(256);
      extent = true;
      parts.sync([item(300, 'read', onMap)]);
      await vi.runAllTimersAsync();
      expect(view.parts).toHaveLength(SURFACE_LIMITS.drawnPerItem);
      expect(fake.asked).toHaveLength(512);
      expect(new Set(fake.asked.slice(256))).toEqual(new Set(fake.asked.slice(0, 256)));
      expect(fake.most()).toBe(SURFACE_LIMITS.displayReads);
    } finally {
      parts.dispose();
      vi.useRealTimers();
    }
  });

  it('does not ask a part read outside the area again when only new parts are read', async () => {
    let published = 2;
    const fake = fakeIo(() => published, (n) => (n === 1 ? outside : placed));
    const { parts, view } = layer(fake.io);
    parts.sync([item(2, 'reading', { placement: 'on_map', limitReason: 'Read 2 of 3 windows.' })]);
    await vi.waitFor(() => expect(view.lines[0]!.line).toContain('1 not placed'));
    published = 3;
    parts.sync([item(3, 'read', { placement: 'on_map', limitReason: 'Read 3 of 3 windows.' })]);
    await vi.waitFor(() => expect(view.parts).toHaveLength(2));
    expect(fake.asked).toEqual([0, 1, 2]);
  });

  it('S9.4d: draws and lists only the files whose parts are placed in the area shown', async () => {
    const fake = fakeIo(() => 1, () => placed);
    fake.io.display = async (shown, partIndex) => ({ partIndex, artifact: { mediaType: 'image/tiff' },
      placement: { state: 'placed', areaId: shown.itemId === 'far' ? 'own-area' : 'batch-area', corners },
    }) as unknown as PartDisplay;
    const view: { parts: SurfacePartInput[]; lines: SurfaceLine[] } = { parts: [], lines: [] };
    const parts = new SurfaceParts(fake.io, (drawn, lines) => { view.parts = drawn; view.lines = lines; },
      'batch-area');
    parts.sync([item(1, 'read'), item(1, 'read', { itemId: 'far', name: 'far.tif' })]);
    await vi.waitFor(() => expect(view.parts.map((part) => part.id)).toEqual(['i-1:0']));
    await vi.waitFor(() => expect(view.lines.map((line) => line.itemId)).toEqual(['i-1']));
    parts.dispose();
  });
});
