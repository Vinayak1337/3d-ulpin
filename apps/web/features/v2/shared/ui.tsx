"use client";
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ArrowsOut } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChartLine } from "@phosphor-icons/react/dist/csr/ChartLine";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { Cube } from "@phosphor-icons/react/dist/csr/Cube";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { Funnel } from "@phosphor-icons/react/dist/csr/Funnel";
import { GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { House } from "@phosphor-icons/react/dist/csr/House";
import { Image } from "@phosphor-icons/react/dist/csr/Image";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { StackSimple } from "@phosphor-icons/react/dist/csr/StackSimple";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { MapTrifold } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { PencilRuler } from "@phosphor-icons/react/dist/csr/PencilRuler";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Ruler } from "@phosphor-icons/react/dist/csr/Ruler";
import { SpinnerGap } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { X } from "@phosphor-icons/react/dist/csr/X";
const icons = {
  back: ArrowLeft,
  arrow: ArrowRight,
  external: ArrowSquareOut,
  expand: ArrowsOut,
  bell: Bell,
  building: Buildings,
  down: CaretDown,
  chevron: CaretRight,
  utility: ChartLine,
  check: Check,
  success: CheckCircle,
  history: ClockCounterClockwise,
  cube: Cube,
  download: DownloadSimple,
  eye: Eye,
  document: FileText,
  filter: Funnel,
  settings: GearSix,
  home: House,
  photo: Image,
  info: Info,
  layers: StackSimple,
  menu: List,
  search: MagnifyingGlass,
  map: MapTrifold,
  minus: Minus,
  workspace: PencilRuler,
  plus: Plus,
  measure: Ruler,
  loading: SpinnerGap,
  register: Stack,
  target: Target,
  upload: UploadSimple,
  warning: Warning,
  close: X,
};
export type IconName = keyof typeof icons;
export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Component = icons[name];
  return (
    <Component
      size={size}
      weight="regular"
      aria-hidden="true"
      className={className}
    />
  );
}
export function Button({
  variant = "secondary",
  icon,
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`v2-button v2-button--${variant} ${className}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return <span className={`v2-badge v2-badge--${tone}`}>{children}</span>;
}
export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v2-panel ${className}`}>
      {(title || actions) && (
        <header className="v2-panel-heading">
          <h2>{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon = "document",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="v2-empty">
      <span className="v2-empty-icon">
        <Icon name={icon} size={25} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function LoadingState({
  label = "Loading workspace",
}: {
  label?: string;
}) {
  return (
    <div className="v2-loading" role="status">
      <Icon name="loading" className="v2-spin" />
      <span>{label}…</span>
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="v2-error" role="alert">
      <Icon name="warning" />
      <span>{message}</span>
      {retry && <Button onClick={retry}>Try again</Button>}
    </div>
  );
}
/** Native dialog provides inert background, escape handling and focus containment. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="v2-dialog"
      aria-label={title}
      onCancel={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <header className="v2-dialog-heading">
        <h2>{title}</h2>
        <Button
          variant="ghost"
          icon="close"
          onClick={onClose}
          aria-label="Close dialog"
        />
      </header>
      <div className="v2-dialog-body">{children}</div>
      {footer && <footer className="v2-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="v2-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export const formatNumber = (value: number | null | undefined, digits = 2) =>
  value == null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
