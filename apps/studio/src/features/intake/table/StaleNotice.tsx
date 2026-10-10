import { Banner, StatusBadge } from '@ulpin/ui';

/** One notice for results the server marks as not current, with its reasons in words. */
export function StaleNotice({ reasons }: { reasons: string[] }) {
  return (
    <Banner tone="warning">
      <span className="ul-row">
        <StatusBadge status="Needs review" />
        These results are from an earlier state of the case{reasons.length ? `: ${reasons.join(', ')}` : ''}.
      </span>
    </Banner>
  );
}
