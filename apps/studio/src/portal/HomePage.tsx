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
        </div>
        <nav aria-label="Tasks" className={styles.tasks}>
          <TaskLink to="/portal/verify" title="Verify a Property Card" />
          <TaskLink to="/portal/map" title="Explore the map" />
          <TaskLink to="/portal/track" title="Track a request" />
        </nav>
      </div>
    </div>
  );
}

function TaskLink({ to, title }: { to: string; title: string }) {
  return (
    <Link to={to} className={styles.task}>
      <span className="portal-h3">{title}</span>
      <Icon icon={ArrowRight} />
    </Link>
  );
}
