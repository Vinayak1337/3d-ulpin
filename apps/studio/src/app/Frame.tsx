import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { CaretDown, FilePlus, MagnifyingGlass, UserCircle } from '@phosphor-icons/react';
import { Icon, Toast } from '@ulpin/ui';
import { useAreas, useCapabilities, useRegisterRequests, useWorkQueue, type Area, type WorkItem } from '../api/queries';
import { isServed } from '../local/routes';
import { readLastArea, writeLastArea } from './lastArea';
import styles from './Frame.module.css';

/**
 * One 56 px header with fixed-width slots, so nothing shifts between pages: wordmark · Batches / Map /
 * Register · search · Add files · area · operator. No theme or language menus (light, English only).
 * When one row cannot hold the slots (browser zoom), they wrap in this same order; nothing is hidden.
 */
export function Frame() {
  const { waiting, notice, dismiss } = useBatchNews();
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link to="/studio/work" className={styles.wordmark} aria-label="BhuAayam Studio, Batches">BhuAayam <small>Studio</small></Link>
        <nav className={styles.nav} aria-label="Studio">
          <NavLink to="/studio/work" aria-label={waiting ? `Batches, ${waiting} need you` : 'Batches'}>
            Batches{waiting ? <span className={styles.navDot} aria-hidden="true" /> : null}
          </NavLink>
          <MapNavLink />
          <RegisterNavLink />
        </nav>
        <HeaderSearch />
        <span className={styles.spacer} />
        <div className={styles.actions}>
          <Link to="/studio/add-files" className={`ul-btn ul-btn--ghost ${styles.addFiles}`}>
            <Icon icon={FilePlus} />Add files
          </Link>
          <AreaSwitcher />
          <OperatorMenu />
        </div>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      {notice ? <Toast key={notice.id} onDone={dismiss}>
        {notice.name} · Reading done <Link to={`/studio/work/cases/${notice.id}/intake`}>Open</Link>
      </Toast> : null}
    </div>
  );
}

function useBatchNews() {
  const { data } = useWorkQueue('all', '', 1);
  const previous = useRef(new Map<string, WorkItem['intakeSummary']>());
  const [notices, setNotices] = useState<WorkItem[]>([]);
  const dismiss = useCallback(() => setNotices(current => current.slice(1)), []);
  useEffect(() => {
    if (!data) return;
    const cases = data.items.filter(item => item.kind === 'case');
    const finished = cases.filter(item => previous.current.get(item.id)?.step === 'Reading'
      && item.intakeSummary && ['Your answers', 'Confirm', 'Cards'].includes(item.intakeSummary.step));
    previous.current = new Map(cases.map(item => [item.id, item.intakeSummary]));
    if (finished.length) setNotices(current => [...current, ...finished]);
  }, [data]);
  return { waiting: data?.waitingBatches ?? 0, notice: notices[0], dismiss };
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

/** Requests from the public are a draft route: only a build that serves it is asked for them. */
const REQUESTS_SERVED = isServed('GET', '/api/v1/register-requests');

/** Register, with the count of open requests from the public where the build serves them. */
function RegisterNavLink() {
  const open = useRegisterRequests('open', { enabled: REQUESTS_SERVED }).data?.length ?? 0;
  return (
    <NavLink to="/studio/registry" aria-label={open ? `Register, ${open} open requests` : 'Register'}>
      Register{open ? <span className={styles.navCount}>{open}</span> : null}
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
        placeholder="Search"
        value={value}
        maxLength={150}
        onChange={(event) => setValue(event.target.value)}
      />
      <kbd className="ul-kbd">/</kbd>
    </form>
  );
}

/** Revision, the short id that tells two areas of one name apart, and the feature count when the record has one. */
function areaSubtitle(area: Area) {
  const hasCount = typeof area.featureCount === 'number';
  return (
    <>
      Revision {area.revision} · <span className={styles.areaId}>{area.id.slice(0, 8)}</span>
      {hasCount ? ` · ${area.featureCount} features` : ''}
    </>
  );
}

function AreaSwitcher() {
  const areas = useAreas();
  const match = useMatch('/studio/areas/:areaId');
  const navigate = useNavigate();
  // Only an area page names an area; the remembered area is for the Map link, not for what the header says.
  const currentId = match?.params.areaId;
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

  const label = current?.name ?? (areas.isPending ? 'Loading areas' : areas.data?.length ? 'Choose an area' : 'No areas');
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
  const title = runtime === 'external-configured' ? 'Operator' : 'Duty officer';
  return (
    <span className={styles.operator} title={title}>
      <Icon icon={UserCircle} size={24} label={title} />
    </span>
  );
}
