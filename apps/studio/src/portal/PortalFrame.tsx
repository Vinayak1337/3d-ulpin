import { Link, NavLink, Outlet } from 'react-router';
import styles from './Portal.module.css';

/** The public portal frame: wordmark, three tasks and the record disclaimer. No sign-in is needed to search, view or verify. */
export function PortalFrame() {
  return (
    <div className={styles.frame}>
      <a href="#portal-main" className={styles.skip}>Skip to content</a>
      <header className={styles.header}>
        <Link to="/portal" className={styles.brand}>
          <span className="ul-wordmark">BhuAayam</span>
          <span className={styles.dept}>Land records</span>
        </Link>
        <nav aria-label="Portal" className={styles.nav}>
          <NavLink to="/portal" end>Search</NavLink>
          <NavLink to="/portal/map">Map</NavLink>
          <NavLink to="/portal/verify">Verify a card</NavLink>
        </nav>
      </header>
      <main id="portal-main" className={styles.main}><Outlet /></main>
      <footer className={styles.footer}>A technical record of land and buildings, not a title document. Owner names and documents are not public.</footer>
    </div>
  );
}

export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 ? <span aria-hidden="true">/</span> : null}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}
