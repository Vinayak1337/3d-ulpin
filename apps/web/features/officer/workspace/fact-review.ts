import type { FactCandidate, ImportPackage, SourceLocator } from "@ulpin/contracts";

const groupKey = (fact: FactCandidate) => JSON.stringify([fact.entityId, fact.subject, fact.property]);
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, normalized(value)]),
  );
  return value;
}
const valueKey = (fact: FactCandidate) => JSON.stringify(normalized([fact.value, fact.unit ?? null, fact.referenceFrameId ?? null]));
export function groupPreparationFacts(facts: FactCandidate[], selectedIds: string[] = []) {
  const selected = new Set(selectedIds);
  const reviewed = facts.filter((fact) => selected.has(fact.id));
  const resolved = new Set(reviewed.map(groupKey));
  const pending = facts.filter((fact) => !selected.has(fact.id) && !resolved.has(groupKey(fact)));
  const values = new Map<string, Set<string>>();
  pending.forEach((fact) => {
    const key = groupKey(fact);
    if (!values.has(key)) values.set(key, new Set());
    values.get(key)!.add(valueKey(fact));
  });
  const distinctValues = (fact: FactCandidate) => values.get(groupKey(fact))?.size ?? 0;
  return {
    pending: pending.toSorted((a, b) => distinctValues(b) - distinctValues(a)),
    reviewed,
    alternatives: facts.filter((fact) => !selected.has(fact.id) && resolved.has(groupKey(fact))),
    conflictingIds: new Set(pending.filter((fact) => distinctValues(fact) > 1).map((fact) => fact.id)),
  };
}

export function evidenceLabel(evidence: SourceLocator, pkg: ImportPackage, sources: { id: string; name: string }[]) {
  const name = sources.find((source) => source.id === evidence.sourceRevisionId)?.name ?? "Retained source";
  const part = pkg.parts.find((part) => part.id === evidence.partId);
  const location = evidence.page ? `Page ${evidence.page}` : evidence.row ? `Row ${evidence.row}` :
    part?.locator.match(/(?:page|row|line)\s*\d+/i)?.[0];
  return `${name}${location ? ` · ${location}` : ""}`;
}

export function evidencePage(evidence: SourceLocator, pkg: ImportPackage) {
  if (evidence.page) return evidence.page;
  const locator = pkg.parts.find((part) => part.id === evidence.partId)?.locator;
  const page = locator?.match(/page\s*(\d+)/i)?.[1];
  return page ? Number(page) : undefined;
}
