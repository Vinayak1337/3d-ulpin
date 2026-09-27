import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Buildings, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import { useMapIdentifierSearch, type AreaFeature } from '../../api/queries';
import styles from './BuildingSearch.module.css';

type Result = { id: string; areaId: string; name: string; identifier: string };

/** Loaded source proposals plus the canonical resolver; no per-building register fan-out. */
export function BuildingSearch({ buildings, areaId, onSelect, autoFocus = false }: {
  buildings: AreaFeature[]; areaId: string; onSelect: (id: string, areaId: string) => void; autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();
  const term = query.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const remote = useMapIdentifierSearch(debounced);
  const current = debounced === term;
  const results = useMemo(() => {
    if (!term) return [];
    const q = term.toLocaleLowerCase();
    const rows = new Map<string, Result>();
    const add = (feature: AreaFeature, identifier = feature.identifier) => {
      if (feature.kind === 'building') rows.set(feature.id, { id: feature.id, areaId: feature.areaId, name: feature.name, identifier });
    };
    for (const b of buildings) {
      const props = b.properties ?? {};
      const values = [b.name, b.id, b.identifier, b.sourceKey,
        ...['ulpin', 'officialUlpin', 'official_ulpin', 'registryId', 'registry_id'].map((key) => props[key])];
      if (values.some((v) => (typeof v === 'string' || typeof v === 'number') && String(v).toLocaleLowerCase().includes(q))) add(b);
    }
    if (current) for (const match of remote.data?.matches ?? []) {
      if (match.feature?.kind === 'building') add(match.feature, match.record?.identifier ?? match.feature.identifier);
      // Only confirmed associations, never inferred parcel intersections.
      for (const b of match.confirmedBuildings ?? []) add(b);
    }
    return [...rows.values()];
  }, [buildings, term, current, remote.data]);
  const loading = term.length >= 3 && (!current || remote.isFetching);
  const choose = (row: Result) => { setOpen(false); onSelect(row.id, row.areaId || areaId); };
  return (
    <div ref={container} className={styles.search} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <form role="search" aria-label="Find a building" className={styles.bar} onSubmit={(event) => {
        event.preventDefault(); setOpen(true); if (results.length === 1) choose(results[0]!);
      }}>
        <Icon icon={MagnifyingGlass} size={20} />
        <input ref={input} type="search" aria-label="Search buildings by ULPIN, name or registry ID"
          placeholder="ULPIN, building name or registry ID" maxLength={150} value={query}
          aria-controls={open && term ? listId : undefined} autoComplete="off"
          onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
          }} />
        {query ? <button type="button" className={styles.clear} aria-label="Clear building search" onClick={() => {
          setQuery(''); input.current?.focus();
        }}><Icon icon={X} size={16} /></button> : null}
      </form>
      {open && term ? <div id={listId} className={styles.results}>
        <p className={styles.status} role="status">
          {loading ? 'Searching records…' : results.length ? `${results.length} building${results.length === 1 ? '' : 's'} found`
            : remote.isError && current ? 'Registry search is unavailable. No loaded buildings match.'
              : current && remote.data?.matches.length ? 'Matching record has no confirmed building to open.' : 'No matching buildings.'}
        </p>
        {remote.isError && current && results.length > 0 ? <p className={styles.status}>Registry search is unavailable. Showing loaded buildings.</p> : null}
        <ul aria-label="Building search results">
          {results.slice(0, 20).map((row) => <li key={row.id}>
            <button type="button" onClick={() => choose(row)}>
              <Icon icon={Buildings} size={20} />
              <span><strong>{row.name}</strong><small>{row.identifier || row.id}</small></span>
            </button>
          </li>)}
        </ul>
        {results.length > 20 ? <p className={styles.status}>Showing the first 20. Refine your search.</p> : null}
      </div> : null}
    </div>
  );
}
