import { Banner } from '@ulpin/ui';
import styles from './Table.module.css';

const NOTICE_ID = 'table-stale-notice';

/** Where focus goes when a result turns stale under an open dialog. */
export function focusStaleNotice() {
  document.getElementById(NOTICE_ID)?.focus();
}

/** One notice for results the server marks as not current, with its reasons in words. */
export function StaleNotice({ reasons }: { reasons: string[] }) {
  return (
    <div id={NOTICE_ID} className={styles.notice} tabIndex={-1}>
      <Banner tone="warning">
        These results are from an earlier state of the case{reasons.length ? `: ${reasons.join(', ')}` : ''}.
        Nothing can be recorded or approved from them.
      </Banner>
    </div>
  );
}
