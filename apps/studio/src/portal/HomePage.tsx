import { Link } from 'react-router';
import { ArrowRight } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import { SearchForm } from './SearchForm';
import styles from './Portal.module.css';

/** P1: find a property record, verify a card or explore the map. */
export function HomePage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.home}>
        <div className={styles.homeMain}>
          <h1 className="portal-display">Find a building or property record</h1>
          <SearchForm />
          <div className={styles.explain}>
            <span className="portal-label">What this record shows</span>
            <span className="portal-body ul-muted">Every building has a 3D ULPIN. Released flats show level, elevations, carpet area and undivided share. No owner names. A technical record, not a title document.</span>
          </div>
        </div>
        <nav aria-label="Tasks" className={styles.tasks}>
          <TaskLink to="/portal/verify" title="Verify a Property Card" detail="Check a card's code and revision" />
          <TaskLink to="/portal/map" title="Explore the map" detail="Every building with its 3D ULPIN, in 3D" />
          <TaskLink to="/portal/track" title="Track a request" detail="A register or correction you asked for" />
        </nav>
      </div>
    </div>
  );
}

function TaskLink({ to, title, detail }: { to: string; title: string; detail: string }) {
  return (
    <Link to={to} className={styles.task}>
      <span><span className="portal-h3">{title}</span><span className="portal-body-sm ul-muted">{detail}</span></span>
      <Icon icon={ArrowRight} />
    </Link>
  );
}
