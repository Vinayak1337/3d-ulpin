import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { CaretDown, Database, MagnifyingGlass, UserCircle } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import { useAreas, useCapabilities, type Area } from '../api/queries';
import { useLocalSources } from './useResponseOrigins';
import { readLastArea, writeLastArea } from './lastArea';
import styles from './Frame.module.css';

/** GOAL override 1: one 56 px header, no scope strip, no language/More/theme menus, no Live pill. */
export function Frame() {
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <span className={styles.wordmark}>3D ULPIN <small>Studio</small></span>
        <nav className={styles.nav} aria-label="Studio">
          <NavLink to="/studio/work">Batches</NavLink>
          <MapNavLink />
          <NavLink to="/studio/registry">Register</NavLink>
        </nav>
        <HeaderSearch />
        <AreaSwitcher />
        <LocalDataBadge />
        <OperatorMenu />
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

function MapNavLink() {
  const onArea = useMatch('/studio/areas/:areaId');
  const lastArea = readLastArea();
  return (
    <NavLink to={lastArea ? `/studio/areas/${lastArea}` : '/studio/map'} aria-current={onArea ? 'page' : undefined}>
      Map
    </NavLink>
  );
}

function HeaderSearch() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(params.get('q') ?? '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      className={styles.search}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = value.trim();
        navigate(q ? `/studio/work?q=${encodeURIComponent(q)}` : '/studio/work');
      }}
    >
      <Icon icon={MagnifyingGlass} size={16} />
      <label className="ul-visually-hidden" htmlFor="studio-search">Search batches</label>
      <input
        id="studio-search"
        ref={inputRef}
        type="search"
        placeholder="Search batches by name or ID"
        value={value}
        maxLength={150}
        onChange={(event) => setValue(event.target.value)}
      />
      <kbd className="ul-kbd">/</kbd>
    </form>
  );
}

function areaSubtitle(area: Area): string {
  const kind = area.dataKind;
  const classification =
    kind === 'real' ? 'Observed source' : kind === 'demonstration' ? 'Synthetic source' : kind === 'mixed' ? 'Mixed source'
      : kind === 'empty' ? 'No features' : 'Unknown source classification';
  return `Revision ${area.revision} · ${classification}`;
}

function AreaSwitcher() {
  const areas = useAreas();
  const match = useMatch('/studio/areas/:areaId');
  const navigate = useNavigate();
  const currentId = match?.params.areaId ?? readLastArea();
  const current = areas.data?.find((area) => area.id === currentId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (match?.params.areaId) writeLastArea(match.params.areaId);
  }, [match?.params.areaId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const label = current?.name ?? (areas.isPending ? 'Loading areas' : areas.data?.length ? 'Choose an area' : 'No areas yet');
  return (
    <div className={styles.areaSwitcher} ref={rootRef}>
      <button
        type="button"
        className={styles.areaButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!areas.data?.length}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.areaText}>
          <span className={styles.areaName}>{label}</span>
          {current ? <span className={styles.areaMeta}>{areaSubtitle(current)}</span> : null}
        </span>
        <Icon icon={CaretDown} size={16} />
      </button>
      {open && areas.data ? (
        <ul className={styles.areaMenu} role="listbox" aria-label="Areas">
          {areas.data.map((area) => (
            <li key={area.id} role="option" aria-selected={area.id === currentId}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(`/studio/areas/${area.id}`);
                }}
              >
                <span className={styles.areaName}>{area.name}</span>
                <span className={styles.areaMeta}>{areaSubtitle(area)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Shown whenever a local route answered (GOAL section 7). Names the local sources on hover. */
function LocalDataBadge() {
  const sources = useLocalSources();
  if (!sources.length) return null;
  return (
    <span className={`ul-badge ul-badge--info ${styles.localBadge}`} title={`Answered locally: ${sources.join('; ')}`}>
      <Icon icon={Database} size={16} />
      Local data
    </span>
  );
}

function OperatorMenu() {
  const capabilities = useCapabilities();
  const runtime = capabilities.data?.runtime;
  const title =
    runtime === 'loopback-configured' ? 'Local operator on the loopback API. There is no sign-in yet.'
      : runtime === 'external-configured' ? 'Operator configured by the external runtime.'
        : 'Operator not confirmed: the API has not answered.';
  return (
    <span className={styles.operator} title={title}>
      <Icon icon={UserCircle} size={24} label={title} />
    </span>
  );
}
