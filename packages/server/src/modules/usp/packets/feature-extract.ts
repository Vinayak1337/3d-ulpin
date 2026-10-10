type Member = { name: string; start: number; end: number };

function whitespaceEnd(text: string, start: number): number {
  while (start < text.length && /[\t\n\r ]/.test(text[start])) start++;
  return start;
}

function stringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '"') return index + 1;
  }
  throw new Error('Incomplete string');
}

function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] !== '{' && text[start] !== '[') {
    let end = start;
    while (end < text.length && !/[\t\n\r ,}\]]/.test(text[end])) end++;
    return end;
  }
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const token = text[index];
    if (token === '"') index = stringEnd(text, index) - 1;
    else if (token === '{' || token === '[') depth++;
    else if ((token === '}' || token === ']') && --depth === 0) return index + 1;
  }
  throw new Error('Incomplete value');
}

function objectMembers(text: string, start: number): Member[] {
  const members: Member[] = [];
  let position = whitespaceEnd(text, start + 1);
  while (text[position] !== '}') {
    const nameEnd = stringEnd(text, position);
    const name = JSON.parse(text.slice(position, nameEnd)) as string;
    const colon = whitespaceEnd(text, nameEnd);
    const valueStart = whitespaceEnd(text, colon + 1);
    const end = valueEnd(text, valueStart);
    members.push({ name, start: valueStart, end });
    position = whitespaceEnd(text, end);
    if (text[position] === ',') position = whitespaceEnd(text, position + 1);
  }
  return members;
}

function arrayElement(text: string, start: number, wanted: number): number | null {
  let position = whitespaceEnd(text, start + 1);
  let index = 0;
  while (text[position] !== ']') {
    if (index === wanted) return position;
    position = whitespaceEnd(text, valueEnd(text, position));
    if (text[position] === ',') position = whitespaceEnd(text, position + 1);
    index++;
  }
  return null;
}

/** The source's own words: the properties object of element N, with its original spelling and whitespace. */
export function featurePropertiesExtract(original: Buffer, featureIndex: number): string | null {
  if (!Number.isSafeInteger(featureIndex) || featureIndex < 0) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(original);
    // Validate the entire file first: an early selected span must not conceal a truncated remainder.
    JSON.parse(text);
    const root = whitespaceEnd(text, 0);
    if (text[root] !== '{') return null;
    const features = objectMembers(text, root).filter(member => member.name === 'features');
    if (features.length !== 1 || text[features[0].start] !== '[') return null;
    const element = arrayElement(text, features[0].start, featureIndex);
    if (element === null || text[element] !== '{') return null;
    const properties = objectMembers(text, element).filter(member => member.name === 'properties');
    if (properties.length !== 1 || text[properties[0].start] !== '{') return null;
    return text.slice(properties[0].start, properties[0].end);
  } catch {
    return null;
  }
}
