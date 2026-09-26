import type { ReactNode } from 'react';

/** The standard container: head (title + aside), body, optional flush content, footer with ≤ 1 primary. */
export function Panel({ title, aside, children, flush, footer, className, headingLevel = 2 }: {
  title?: ReactNode; aside?: ReactNode; children?: ReactNode; flush?: ReactNode; footer?: ReactNode; className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`ul-panel${className ? ` ${className}` : ''}`}>
      {title ? (
        <header className="ul-panel__head">
          <Heading className="ul-panel__title">{title}</Heading>
          {aside}
        </header>
      ) : null}
      {children ? <div className="ul-panel__body">{children}</div> : null}
      {flush}
      {footer ? <footer className="ul-panel__foot">{footer}</footer> : null}
    </section>
  );
}
