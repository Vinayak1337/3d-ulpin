"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { OfficerStoreProvider } from "./store";
import { Icon, Badge, Dialog } from "./ui";
import { useResource } from "./hooks";
import "./ui.css";
import "./shell.css";
import ProductHeader from "../../studio/product/ProductHeader";
import "../../studio/product/operations.css";
import "../../studio/product/theme.css";
import { workspacePrivacyCopy, type WorkspaceCapabilities } from "@/lib/workspace-capabilities";
function Navigation({ children }: { children: ReactNode }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const health = useResource<{
    ok: boolean;
    services: Record<string, boolean>;
  }>(statusOpen ? "/health" : null);
  const capabilities = useResource<WorkspaceCapabilities>(statusOpen ? "/workspace-capabilities" : null);
  const privacy = workspacePrivacyCopy(capabilities.data ?? undefined);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div className="ulpin-app studio-operations" data-ui-shell data-theme="light">
      <a className="ui-skip" href="#ui-content">
        Skip to content
      </a>
      <ProductHeader actions={<button onClick={()=>setStatusOpen(true)} aria-label="Local workspace status"><span className={online?'ui-dot':'ui-dot ui-dot--offline'}/><span>Local workspace</span></button>}/>

      <div id="ui-content" className="ui-content">
        {children}
      </div>
      <Dialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Local workspace"
      >
        <div className="ui-status-summary">
          <Icon name="info" size={30} />
          <div>
            <h3>Evidence processing</h3>
            <p>{privacy.runtime}</p>
            <p>{privacy.provider}</p>
            <p>{privacy.residency}</p>
          </div>
        </div>
        {health.error && <p role="alert">{health.error}</p>}
        {capabilities.error && <p role="alert">Processing status is unavailable. Data residency is unverified.</p>}
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
          <Link href="/studio/registry">Browse registers</Link>
          <Link href="/studio/workspaces">Browse workspaces</Link>
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
