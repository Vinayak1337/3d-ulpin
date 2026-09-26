import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { CaretDown, FilePlus, MagnifyingGlass, UserCircle } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import { useAreas, useCapabilities, type Area } from '../api/queries';
import { readLastArea, writeLastArea } from './lastArea';
import styles from './Frame.module.css';

/**
 * One 56 px header with fixed-width slots, so nothing shifts between pages: wordmark · Batches / Map /
 * Register · search · Add files · area · operator. No theme or language menus (light, English only).
 */
export function Frame() {
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link to="/studio/work" className={styles.wordmark} aria-label="BhuAayam Studio, Batches">BhuAayam <small>Studio</small></Link>
        <nav className={styles.nav} aria-label="Studio">
          <NavLink to="/studio/work">Batches</NavLink>
          <MapNavLink />
          <NavLink to="/studio/registry">Register</NavLink>
        </nav>
        <HeaderSearch />
        <span className={styles.spacer} />
        <Link to="/studio/add-files" className={`ul-btn ul-btn--ghost ${styles.addFiles}`}><Icon icon={FilePlus} />Add files</Link>
        <AreaSwitcher />
        <OperatorMenu />
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

function MapNavLink() {
  // NavLink would compute "active" from its own `to`, which is /studio/map until an area is remembered;
  // a plain link with an explicit current state keeps the tab highlighted on every area page.
  const onArea = useMatch('/studio/areas/:areaId');
  const onIndex = useMatch('/studio/map');
  const lastArea = onArea?.params.areaId ?? readLastArea();
  return (
    <Link to={lastArea ? `/studio/areas/${lastArea}` : '/studio/map'} aria-current={onArea || onIndex ? 'page' : undefined}>
      Map
    </Link>
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
        placeholder="Search batches, buildings, codes"
        value={value}
        maxLength={150}
        onChange={(event) => setValue(event.target.value)}
      />
      <kbd className="ul-kbd">/</kbd>
    </form>
  );
}

function areaSubtitle(area: Area): string {
  return `Revision ${area.revision}${area.featureCount ? ` · ${area.featureCount} features` : ''}`;
}

function AreaSwitcher() {
  const areas = useAreas();
  const match = useMatch('/studio/areas/:areaId');
  const navigate = useNavigate();
  const currentId = match?.params.areaId ?? readLastArea();
  const current = areas.data?.find((area) => area.id === currentId) ?? areas.data?.[0];
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
            <li key={area.id} role="option" aria-selected={area.id === current?.id}>
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

function OperatorMenu() {
  const capabilities = useCapabilities();
  const runtime = capabilities.data?.runtime;
  const title =
    runtime === 'external-configured' ? 'Operator configured by the identity service.'
      : 'Duty officer on this workstation.';
  return (
    <span className={styles.operator} title={title}>
      <Icon icon={UserCircle} size={24} label={title} />
    </span>
  );
}
