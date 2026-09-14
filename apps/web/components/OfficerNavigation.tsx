"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import "./OfficerNavigation.css";
export interface OfficerContext {
  buildingId?: string;
  areaId?: string;
  caseId?: string;
}
export function retainOfficerContext(context: OfficerContext) {
  try {
    const previous = JSON.parse(
      sessionStorage.getItem("ulpin-officer-context") || "{}",
    );
    const next = { ...previous, ...context };
    if (
      context.buildingId !== undefined &&
      context.buildingId !== previous.buildingId &&
      !Object.hasOwn(context, "caseId")
    )
      delete next.caseId;
    if (
      Object.hasOwn(context, "areaId") &&
      context.areaId !== previous.areaId &&
      !Object.hasOwn(context, "buildingId")
    ) {
      delete next.buildingId;
      delete next.caseId;
    }
    sessionStorage.setItem("ulpin-officer-context", JSON.stringify(next));
    window.dispatchEvent(new Event("ulpin-property-context"));
  } catch {
    /* Navigation continues without browser storage. */
  }
}
export default function OfficerNavigation() {
  const pathname = usePathname(),
    [context, setContext] = useState<OfficerContext>({}),
    [hasCase, setHasCase] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setContext(
          JSON.parse(sessionStorage.getItem("ulpin-officer-context") || "{}"),
        );
      } catch {
        setContext({});
      }
      setHasCase(new URLSearchParams(window.location.search).has("case"));
    };
    read();
    window.addEventListener("ulpin-property-context", read);
    return () => window.removeEventListener("ulpin-property-context", read);
  }, [pathname]);
  const block = context.areaId
    ? `/areas/${context.areaId}${context.buildingId ? `?feature=${context.buildingId}` : ""}`
    : "/areas";
  const register = context.buildingId
    ? `/properties/${context.buildingId}`
    : "/registry";
  const workspace = context.buildingId
    ? `/properties/${context.buildingId}/prepare`
    : context.caseId
      ? `/workbench?case=${context.caseId}`
      : "/workbench";
  const active =
    pathname.includes("/prepare") || pathname === "/workbench" || hasCase
      ? "workspace"
      : pathname.startsWith("/properties") ||
          pathname.startsWith("/registry") ||
          pathname.startsWith("/sites")
        ? "register"
        : "block";
  return (
    <nav className="officer-navigation" aria-label="Main workspace">
      <a
        className="officer-nav-mark"
        href={block}
        aria-label="3D ULPIN block home"
      >
        ◈
      </a>
      <a href={block} aria-current={active === "block" ? "page" : undefined}>
        <span aria-hidden="true">▧</span>3D Block
      </a>
      <a
        href={register}
        aria-current={active === "register" ? "page" : undefined}
      >
        <span aria-hidden="true">▤</span>Property Register
      </a>
      <a
        href={workspace}
        aria-current={active === "workspace" ? "page" : undefined}
      >
        <span aria-hidden="true">⌑</span>Plan Workspace
      </a>
    </nav>
  );
}
