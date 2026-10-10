import { Copy } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';

/** The assigned application code as one exact, copyable string. No segment is given a meaning here. */
export function AssignedCode({ code }: { code: string | null }) {
  if (!code) return <span>No code assigned</span>;
  return (
    <span className="ul-code">
      <span className="ul-code__seg">{code}</span>
      <button type="button" className="ul-code__copy" aria-label={`Copy code ${code}`}
        onClick={() => void navigator.clipboard?.writeText(code)}>
        <Icon icon={Copy} size={16} />
      </button>
    </span>
  );
}
