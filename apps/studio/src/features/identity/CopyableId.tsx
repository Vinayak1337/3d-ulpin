import { Copy } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';

/**
 * An identifier or a code as one exact string with the copy control a code carries (`ul-code`). No segment is
 * given a meaning here. `name` says what is copied, for the control's label: "card id" or "code".
 */
export function CopyableId({ id, name }: { id: string; name: string }) {
  return (
    <span className="ul-code">
      <span className="ul-code__seg">{id}</span>
      <button type="button" className="ul-code__copy" aria-label={`Copy ${name} ${id}`}
        onClick={() => void navigator.clipboard?.writeText(id)}>
        <Icon icon={Copy} size={16} />
      </button>
    </span>
  );
}
