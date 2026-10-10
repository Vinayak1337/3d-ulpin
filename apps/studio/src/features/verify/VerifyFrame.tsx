import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckCircle, Warning, WarningOctagon } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import styles from './VerifyPage.module.css';

const ICONS = { success: CheckCircle, warning: Warning, danger: WarningOctagon };

/** The frame of the verify pages, outside the Studio frame: the wordmark, the way back and one narrow column. */
export function VerifyFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className="ul-wordmark">BhuAayam <small>Verify</small></span>
        <Link to="/studio/work" className="ul-btn ul-btn--ghost">Back to Studio</Link>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

/** The one result a verify page leads with. `small` is for a sentence, such as a failure with its reason. */
export function ResultBanner({ tone, small = false, action, children }: {
  tone: keyof typeof ICONS; small?: boolean; action?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={`${styles.result} ${styles[tone]}${small ? ` ${styles.small}` : ''}`}
      role={tone === 'danger' ? 'alert' : undefined}>
      <Icon icon={ICONS[tone]} />
      <span className={styles.resultText}>{children}</span>
      {action}
    </div>
  );
}
