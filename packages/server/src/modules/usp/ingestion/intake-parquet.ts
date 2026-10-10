import type { IntakeCard } from '@ulpin/contracts/usp';

/** Compact-Thrift metadata cursor only; no column chunk or row is read. */
class FooterCursor {
  at = 0;
  nodes = 0;
  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.at >= this.bytes.length) throw new Error('PARQUET_FOOTER_TRUNCATED');
    return this.bytes[this.at++];
  }

  variable(): number {
    let value = 0;
    let scale = 1;
    for (let index = 0; index < 10; index++) {
      const byte = this.byte();
      value += (byte & 127) * scale;
      if (!Number.isSafeInteger(value)) throw new Error('PARQUET_FOOTER_INTEGER');
      if (!(byte & 128)) return value;
      scale *= 128;
    }
    throw new Error('PARQUET_FOOTER_INTEGER');
  }

  structure(depth: number): Record<number, unknown> {
    const result: Record<number, unknown> = {};
    let field = 0;
    while (true) {
      const header = this.byte();
      if (header === 0) return result;
      const delta = header >> 4;
      if (delta) field += delta;
      else {
        const encoded = this.variable();
        field = (encoded >> 1) ^ -(encoded & 1);
      }
      if (field < 1 || Object.hasOwn(result, field)) throw new Error('PARQUET_FOOTER_FIELD');
      result[field] = this.value(header & 15, depth + 1);
    }
  }

  value(type: number, depth = 0): unknown {
    if (depth > 32 || ++this.nodes > 16384) throw new Error('PARQUET_FOOTER_BOUND');
    if (type === 1 || type === 2) return type === 1;
    if (type === 3) return this.byte();
    if ([4, 5, 6].includes(type)) return this.variable();
    if (type === 7) {
      for (let index = 0; index < 8; index++) this.byte();
      return null;
    }
    if (type === 8) {
      const size = this.variable();
      if (this.at + size > this.bytes.length) throw new Error('PARQUET_FOOTER_TRUNCATED');
      const value = this.bytes.subarray(this.at, this.at + size);
      this.at += size;
      return value;
    }
    if (type === 9 || type === 10) {
      const header = this.byte();
      const size = header >> 4 === 15 ? this.variable() : header >> 4;
      if (size > 16384) throw new Error('PARQUET_FOOTER_BOUND');
      return Array.from({ length: size }, () => this.value(header & 15, depth + 1));
    }
    if (type === 12) return this.structure(depth);
    // Map and unknown wire types stay signature-only; never reinterpret unsupported bytes.
    throw new Error('PARQUET_FOOTER_WIRE_TYPE');
  }
}

export function probeParquet(card: IntakeCard, bytes: Uint8Array) {
  const tail = Buffer.from(bytes);
  if (tail.length < 8 || tail.subarray(-4).toString('ascii') !== 'PAR1') return;
  const size = tail.readUInt32LE(tail.length - 8);
  if (size > tail.length - 8) {
    card.limits.push('Parquet footer exceeds the bounded tail; GeoParquet metadata not established.');
    return;
  }
  try {
    const cursor = new FooterCursor(tail.subarray(tail.length - 8 - size, tail.length - 8));
    const metadata = cursor.structure(0);
    if (cursor.at !== size) throw new Error('PARQUET_FOOTER_TRAILING_BYTES');
    const pairs = metadata[5];
    if (!Array.isArray(pairs)) return;
    const geoPair = pairs.find(pair => pair?.[1] instanceof Uint8Array
      && Buffer.from(pair[1]).toString('utf8') === 'geo');
    if (!(geoPair?.[2] instanceof Uint8Array)) return;
    const geo = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(geoPair[2]));
    if (typeof geo.version !== 'string' || !geo.columns || typeof geo.columns !== 'object') return;
    card.format = 'geoparquet';
    card.family = 'vector';
    card.formatVersion = /^\d+\.\d+\.\d+$/.test(geo.version) ? geo.version : null;
    card.limits.push('GeoParquet metadata identified; layers, row groups and CRS require the native footer reader.');
  } catch {
    card.limits.push('Parquet footer not resolved within the metadata profile; native reader required.');
  }
}
