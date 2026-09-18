import type { ReactNode } from 'react';
import { useDialog } from './useDialog';
export default function DialogSection({onClose,labelledBy,className,children}:{onClose:()=>void;labelledBy:string;className:string;children:ReactNode}){
  const ref=useDialog(onClose);
  return <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={className}>{children}</section>;
}
