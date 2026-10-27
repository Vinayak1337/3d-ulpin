import { writeFile } from 'node:fs/promises';

function formatted(value, depth = 0) {
  const compact = JSON.stringify(value);
  if (compact.length + depth <= 118 || value === null || typeof value !== 'object') return compact;
  const indent = ' '.repeat(depth);
  const childIndent = ' '.repeat(depth + 2);
  if (Array.isArray(value)) {
    const children = value.map((child) => childIndent + formatted(child, depth + 2));
    return `[\n${children.join(',\n')}\n${indent}]`;
  }
  const children = Object.entries(value).map(([key, child]) => {
    const prefix = childIndent + JSON.stringify(key) + ': ';
    const result = formatted(child, depth + 2);
    if (!result.includes('\n') && prefix.length + result.length > 119) {
      return prefix.trimEnd() + '\n' + childIndent + result;
    }
    return prefix + result;
  });
  return `{\n${children.join(',\n')}\n${indent}}`;
}

/** Compact evidence without a giant line or redundant four-line coordinate pairs. */
export async function writeEvidence(path, value) {
  const rounded = JSON.parse(JSON.stringify(value, (key, value) =>
    typeof value === 'number' ? Math.round(value * 1000000) / 1000000 : value));
  await writeFile(path, formatted(rounded) + '\n');
}
