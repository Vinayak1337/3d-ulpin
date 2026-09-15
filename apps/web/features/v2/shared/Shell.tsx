"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { V2StoreProvider, useV2Store } from "./store";
import { routes } from "./routes";
import { Icon, Button, Badge, Dialog } from "./ui";
import { SearchDialog } from "./SearchDialog";
import { useResource } from "./hooks";
import { useNavigationTargets } from "./useNavigationTargets";
import "./v2.css";
import "./shell.css";
function Navigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const storedAreaId = useV2Store((s) => s.selectedAreaId),
    storedBuildingId = useV2Store((s) => s.selectedBuildingId);
  const query = useSearchParams();
  const targets = useNavigationTargets(pathname, query, {
    areaId: storedAreaId,
    buildingId: storedBuildingId,
  });
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
    <div className="ulpin-v2" data-v2-shell>
      <a className="v2-skip" href="#v2-content">
        Skip to content
      </a>
      <header className="v2-topbar">
        <Link
          href={routes.home}
          className="v2-brand"
          aria-label="3D ULPIN home"
        >
          <span className="v2-brandmark">
            <Icon name="layers" size={26} />
          </span>
          <span>
            <strong>
              3D ULPIN<span className="v2-version">V2</span>
            </strong>
            <small>Property intelligence</small>
          </span>
        </Link>
        <nav className="v2-mainnav" aria-label="Main navigation">
          {(
            [
              {
                key: "block",
                label: "Block Map",
                icon: "map",
                href: targets.block,
              },
              {
                key: "register",
                label: "Property Register",
                icon: "register",
                href: targets.register,
              },
              {
                key: "workspace",
                label: "Plan Workspace",
                icon: "workspace",
                href: targets.workspace,
              },
            ] as const
          ).map((item) => (
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
        <div className="v2-header-actions">
          <Button
            variant="ghost"
            icon="search"
            onClick={() => setSearchOpen(true)}
            aria-label="Search properties (Command K)"
          >
            <kbd>⌘ K</kbd>
          </Button>
          <button
            className="v2-local"
            onClick={() => setStatusOpen(true)}
            aria-label="Local workspace status"
          >
            <span className={online ? "v2-dot" : "v2-dot v2-dot--offline"} />
            <span>Local workspace</span>
          </button>
          <button
            className="v2-avatar"
            onClick={() => setStatusOpen(true)}
            aria-label="Workspace settings"
          >
            LO
          </button>
        </div>
      </header>
      <div id="v2-content" className="v2-content">
        {children}
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Dialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Local workspace"
      >
        <div className="v2-status-summary">
          <Icon name="check" size={30} />
          <div>
            <h3>Your evidence stays here</h3>
            <p>One operator · local services · original sources retained</p>
          </div>
        </div>
        {health.error && <p role="alert">{health.error}</p>}
        <div className="v2-service-list">
          {Object.entries(health.data?.services || {}).map(([key, ready]) => (
            <div key={key}>
              <span>{key.replaceAll("_", " ")}</span>
              <Badge tone={ready ? "success" : "warning"}>
                {ready ? "Available" : "Unavailable"}
              </Badge>
            </div>
          ))}
        </div>
        <div className="v2-status-links">
          <Link href="/v2/register">Browse registers</Link>
          <Link href="/v2/workspace">Browse workspaces</Link>
          <a href={routes.legacy}>
            Open previous interface <Icon name="external" size={14} />
          </a>
        </div>
      </Dialog>
    </div>
  );
}
export default function Shell({ children }: { children: ReactNode }) {
  return (
    <V2StoreProvider>
      <Navigation>{children}</Navigation>
    </V2StoreProvider>
  );
}
