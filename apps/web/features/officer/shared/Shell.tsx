"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { OfficerStoreProvider } from "./store";
import { routes } from "./routes";
import { mainNavigation } from "./navigation";
import { Icon, Button, Badge, Dialog } from "./ui";
import { SearchDialog } from "./SearchDialog";
import { useResource } from "./hooks";
import "./ui.css";
import "./shell.css";
function Navigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false),
    [statusOpen, setStatusOpen] = useState(false);
  const health = useResource<{
    ok: boolean;
    services: Record<string, boolean>;
  }>(statusOpen ? "/health" : null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const family = pathname.includes("workspace")
    ? "workspace"
    : pathname.includes("register")
      ? "register"
      : "block";
  return (
    <div className="ulpin-app" data-ui-shell>
      <a className="ui-skip" href="#ui-content">
        Skip to content
      </a>
      <header className="ui-topbar">
        <Link
          href={routes.home}
          className="ui-brand"
          aria-label="3D ULPIN home"
        >
          <span className="ui-brandmark">
            <Icon name="layers" size={26} />
          </span>
          <span>
            <strong>3D ULPIN</strong>
            <small>Property intelligence</small>
          </span>
        </Link>
        <Button
          variant="secondary"
          className="ui-global-search"
          icon="search"
          onClick={() => setSearchOpen(true)}
          aria-label="Search properties (Command K)"
        >
          <span className="ui-search-label">Search property or address</span>
          <kbd>⌘ K</kbd>
        </Button>
        <nav className="ui-mainnav" aria-label="Main navigation">
          {mainNavigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={family === item.key ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="ui-header-actions">
          <button
            className="ui-local"
            onClick={() => setStatusOpen(true)}
            aria-label="Local workspace status"
          >
            <span className={online ? "ui-dot" : "ui-dot ui-dot--offline"} />
            <span>Local workspace</span>
          </button>
          <button
            className="ui-avatar"
            onClick={() => setStatusOpen(true)}
            aria-label="Workspace settings"
          >
            LO
          </button>
        </div>
      </header>
      <div id="ui-content" className="ui-content">
        {children}
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Dialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Local workspace"
      >
        <div className="ui-status-summary">
          <Icon name="check" size={30} />
          <div>
            <h3>Your evidence stays here</h3>
            <p>One operator · local services · original sources retained</p>
          </div>
        </div>
        {health.error && <p role="alert">{health.error}</p>}
        <div className="ui-service-list">
          {Object.entries(health.data?.services || {}).map(([key, ready]) => (
            <div key={key}>
              <span>{key.replaceAll("_", " ")}</span>
              <Badge tone={ready ? "success" : "warning"}>
                {ready ? "Available" : "Unavailable"}
              </Badge>
            </div>
          ))}
        </div>
        <div className="ui-status-links">
          <Link href="/register">Browse registers</Link>
          <Link href="/workspace">Browse workspaces</Link>
        </div>
      </Dialog>
    </div>
  );
}
export default function Shell({ children }: { children: ReactNode }) {
  return (
    <OfficerStoreProvider>
      <Navigation>{children}</Navigation>
    </OfficerStoreProvider>
  );
}
