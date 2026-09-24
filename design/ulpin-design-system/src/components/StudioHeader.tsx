import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge';
import { Icon } from './Icon';

export interface WordmarkProps {
  /** Surface name after the wordmark: Studio, Portal, Admin, Property Card. */
  surface?: string;
  /** Font size of the wordmark in px (default 18). */
  size?: number;
}

/**
 * The product wordmark "3D ULPIN" in Noto Sans 700 with the surface name. There is no logo or emblem.
 */
export function Wordmark({ surface, size }: WordmarkProps) {
  return (
    <span className="ul-wordmark" style={size ? { fontSize: size } : undefined}>
      3D ULPIN{surface && <small>{surface}</small>}
    </span>
  );
}

export interface StudioHeaderProps {
  /** Studio or Admin. */
  surface?: string;
  /** Primary navigation. Studio: Batches · Map · Register. Admin: Overview · Imports · Coverage · Users · Audit · Settings. */
  nav?: string[];
  /** The active section (`aria-current="page"`). */
  active?: string;
  onNavigate?: (item: string) => void;
  /** Search placeholder; search opens with `/`. */
  searchPlaceholder?: string;
  /** Area or dataset switcher label, e.g. "Lake View area". Omit to hide. */
  area?: string;
  /** Live connection status: "Live", or "Snapshot 24 Sep, 14:10" when working from saved data. */
  status?: string;
  /** Tone of the status badge; defaults to success for "Live", neutral otherwise. */
  statusTone?: BadgeTone;
  /** Signed-in user's initials and full name. */
  initials?: string;
  userName?: string;
  /** Extra controls before the user initials (theme toggle, help). */
  actions?: ReactNode;
}

/**
 * The 56px top bar of the Officer Studio and Admin Console: wordmark, primary navigation, search, area switcher, live status, user.
 */
export function StudioHeader({
  surface = 'Studio',
  nav = ['Batches', 'Map', 'Register'],
  active,
  onNavigate,
  searchPlaceholder = 'Search 3D ULPIN, parcel, address',
  area,
  status = 'Live',
  statusTone,
  initials,
  userName,
  actions,
}: StudioHeaderProps) {
  const tone = statusTone ?? (status === 'Live' ? 'success' : 'neutral');
  return (
    <header className="ul-topbar">
      <Wordmark surface={surface} />
      <nav className="ul-nav" aria-label="Primary">
        {nav.map((n) => (
          <a
            key={n}
            href="#"
            aria-current={n === active ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate?.(n);
            }}
          >
            {n}
          </a>
        ))}
      </nav>
      <div className="ul-search" role="search">
        <Icon name="magnifying-glass" size="sm" />
        <span>{searchPlaceholder}</span>
        <span className="ul-kbd">/</span>
      </div>
      {area && (
        <button type="button" className="ul-btn ul-btn--ghost">
          <Icon name="stack" size="sm" />
          {area}
          <Icon name="caret-down" size="sm" />
        </button>
      )}
      <Badge tone={tone} icon={tone === 'success' ? 'check-circle' : 'clock-counter-clockwise'}>
        {status}
      </Badge>
      {actions}
      {initials && (
        <span className="ul-initials" aria-label={userName ? `Signed in as ${userName}` : undefined}>
          {initials}
        </span>
      )}
    </header>
  );
}
