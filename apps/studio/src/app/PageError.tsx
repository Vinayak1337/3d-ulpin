import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { WarningCircle } from '@phosphor-icons/react';
import { Button, EmptyState } from '@ulpin/ui';

/** The name of what went wrong, without its message or stack. */
function errorName(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  return error instanceof Error ? error.name : 'Unknown error';
}

/** A render error in a routed page shows here, inside the frame's main region, with the navigation intact. */
export function PageError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return (
    <div style={{ padding: 'var(--ui-space-6)' }}>
      <EmptyState
        icon={WarningCircle}
        title="This page could not be shown"
        action={<Button onClick={() => navigate(`${pathname}${search}`, { replace: true })}>Retry</Button>}
      >
        {errorName(error)}
      </EmptyState>
    </div>
  );
}
