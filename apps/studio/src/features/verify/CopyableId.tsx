import { Copy } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import styles from './VerifyPage.module.css';

/**
 * An identifier as one exact string with the copy control a code carries (`ul-code`, as in AssignedCode).
 * `name` says what is copied, for the control's label: "card id", for one.
 */
export function CopyableId({ id, name }: { id: string; name: string }) {
  return (
    <span className={`ul-code ${styles.copyable}`}>
      <span className="ul-code__seg">{id}</span>
      <button type="button" className="ul-code__copy" aria-label={`Copy ${name} ${id}`}
        onClick={() => void navigator.clipboard?.writeText(id)}>
        <Icon icon={Copy} size={16} />
      </button>
    </span>
  );
}
