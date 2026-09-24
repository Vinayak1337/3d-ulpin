import { Icon } from './Icon';

export interface PortalHeaderProps {
  /** Product name on the Portal, bold. */
  title?: string;
  /** The department line under it. */
  department?: string;
  /** Label of the language switch button (the other language, in its own script). */
  languageSwitch?: string;
  /** Sign-in button label. */
  signInLabel?: string;
  /** Show the UX4G accessibility bar (skip link, text size, contrast, language). Required on every Portal page. */
  accessibilityBar?: boolean;
}

/**
 * The Public Portal frame: UX4G accessibility bar, then a 64px header with the department-mark slot, name, language switch and sign-in.
 */
export function PortalHeader({
  title = '3D ULPIN Portal',
  department = 'Land records department · demonstration',
  languageSwitch = 'हिन्दी',
  signInLabel = 'Sign in',
  accessibilityBar = true,
}: PortalHeaderProps) {
  return (
    <div>
      {accessibilityBar && (
        <div className="ul-a11ybar">
          <a href="#main">Skip to main content</a>
          <span>Text size A- A A+</span>
          <span>High contrast</span>
          <span>English / हिन्दी</span>
        </div>
      )}
      <header className="ul-portalhead">
        <span className="ul-deptslot">Dept. mark</span>
        <span className="ul-dept">
          <strong>{title}</strong>
          <span>{department}</span>
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ul-btn ul-btn--ghost">
          <Icon name="translate" size="sm" />
          {languageSwitch}
        </button>
        <button type="button" className="ul-btn ul-btn--lg">
          {signInLabel}
        </button>
      </header>
    </div>
  );
}
