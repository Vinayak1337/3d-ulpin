import { CANONICAL_TARGETS, type ColumnProfile, type ColumnProfileDocument,
  type MappingPlanV2, type CanonicalTarget } from '@ulpin/contracts';
import { UNIT_SUFFIXES, UNIT_TABLE } from './unit-table';

type Rule = { name: string; target: CanonicalTarget; header: RegExp };
export type RuleField = { field: MappingPlanV2['fields'][number]; method: string };
const rules: Rule[] = [
  { name: 'building-key', target: 'building.sourceKey',
    header: /^(?:bin|building (?:id|identifier|key|number)|भवन (?:संख्या|क्रमांक))$/u },
  { name: 'building-name', target: 'building.name', header: /^(?:building name|भवन का नाम|भवन नाम)$/u },
  { name: 'building-address', target: 'building.addressLiteral',
    header: /^(?:building address|भवन का पता|भवन पता)$/u },
  { name: 'building-height', target: 'building.heightM',
    header: /^(?:(?:building |roof )?height(?: roof)?|भवन की ऊंचाई|भवन ऊंचाई|ऊंचाई|ऊँचाई)$/u },
  { name: 'storey-count', target: 'building.storeyCount',
    header: /^(?:(?:number|no|count) of (?:floors|storeys|stories)|(?:floor|storey|story) count|मंजिलों की संख्या)$/u },
  { name: 'storey-label', target: 'building.storeyLabel',
    header: /^(?:storey expression|storeys|stories|मंजिल विवरण)$/u },
  { name: 'khasra', target: 'parcel.khasra', header: /^(?:khasra(?: (?:no|number))?|खसरा(?: (?:नंबर|संख्या))?)$/u },
  { name: 'plot', target: 'parcel.plot', header: /^(?:plot (?:no|number)|प्लॉट (?:नंबर|संख्या))$/u },
  { name: 'survey', target: 'parcel.survey', header: /^(?:survey (?:no|number)|सर्वे (?:नंबर|संख्या))$/u },
  { name: 'parcel-area', target: 'parcel.area', header: /^(?:parcel area|plot area|भूखंड क्षेत्रफल)$/u },
  { name: 'carpet-area', target: 'unit.carpetArea', header: /^(?:carpet area|कारपेट क्षेत्रफल)$/u },
  { name: 'built-up-area', target: 'unit.builtUpArea', header: /^(?:built up area|निर्मित क्षेत्रफल)$/u },
  { name: 'unit-number', target: 'unit.unitNo', header: /^(?:unit (?:no|number)|इकाई (?:नंबर|संख्या))$/u },
  { name: 'floor-label', target: 'unit.floorLabel', header: /^(?:floor label|मंजिल का नाम)$/u },
];

function header(column: ColumnProfile): string {
  const text = column.name.replace(/^\d+\|/u, '').normalize('NFC').toLowerCase()
    .replace(/[_().\[\]-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!column.declaredUnit || column.declaredUnit === 'count') return text;
  const words = text.split(' ');
  for (let length = Math.min(3, words.length); length > 0; length--) {
    if (UNIT_SUFFIXES[column.declaredUnit].test(words.slice(-length).join(' '))) {
      return words.slice(0, -length).join(' ');
    }
  }
  return text;
}

function matchColumn(column: ColumnProfile, buildingContext: boolean): RuleField | undefined {
  const name = header(column);
  const rule = rules.find(rule => rule.header.test(name)) ??
    (name === 'name' && buildingContext ? { name: 'building-name', target: 'building.name' as const } : undefined);
  if (!rule || ['object', 'array', 'geometry', 'boolean', 'mixed'].includes(column.inferredType)) return;
  const definition = CANONICAL_TARGETS[rule.target];
  let operation: MappingPlanV2['fields'][number]['operation'] = { kind: 'copy' };
  if (definition.unitFamily !== 'none') {
    if (column.inferredType !== 'number' || (column.valueShapes.floorLabelRate ?? 0) > 0) return;
    if (definition.unitFamily === 'count') {
      if (column.declaredUnit && column.declaredUnit !== 'count') return;
      // The explicit count header states the dimension; no length/area unit is manufactured.
    } else {
      if (!column.declaredUnit || UNIT_TABLE[column.declaredUnit].family !== definition.unitFamily) return;
      operation = { kind: 'unit_convert', sourceUnit: column.declaredUnit };
    }
  }
  if (rule.target === 'unit.floorLabel' || rule.target === 'building.storeyLabel') {
    if (column.inferredType !== 'text') return;
  }
  return { method: `rule:${rule.name}@1`, field: { sourceField: column.name, target: rule.target,
    operation, confidence: 1, rationale: `Explicit source header matched ${rule.name}; officer review required.` } };
}

/** Clear source meanings only; ambiguous competing columns remain unmatched, never last-column-wins. */
export function proposeMappingRules(profile: ColumnProfileDocument): RuleField[] {
  const buildingContext = profile.columns.some(column =>
    rules.some(rule => rule.target === 'building.sourceKey' && rule.header.test(header(column))));
  const matched = profile.columns.flatMap(column => {
    const match = matchColumn(column, buildingContext);
    return match ? [match] : [];
  });
  const counts = new Map<string, number>();
  for (const { field } of matched) counts.set(field.target, (counts.get(field.target) ?? 0) + 1);
  return matched.filter(({ field }) => counts.get(field.target) === 1);
}
