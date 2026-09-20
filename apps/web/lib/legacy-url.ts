import { studioProductUrl } from "../features/studio/product/urls";

/** Compatibility for historical presentation links; source and API paths are untouched. */
export function legacyUrl(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  const url = new URL(value, "http://local");
  let path = url.pathname.replace(/^\/legacy(?=\/|$)/, "") || "/";
  path = path.replace(/^\/v2(?=\/|$)/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (path === "/")
    path = url.searchParams.get("case")
      ? `/workspace/${encodeURIComponent(url.searchParams.get("case")!)}`
      : "/studio/work";
  else if (parts[0] === "areas")
    path = "/blocks" + path.slice("/areas".length);
  else if (
    parts[0] === "properties" &&
    parts[1] &&
    (parts.length === 2 || (parts.length === 3 && parts[2] === "prepare"))
  )
    path = `/properties/${parts[1]}/${parts[2] === "prepare" ? "workspace" : "register"}`;
  else if (parts[0] === "registry")
    path = parts[1] ? `/register/records/${parts.slice(1).join("/")}` : "/register";
  else if (parts[0] === "sites")
    path = parts[1] ? `/register/sites/${parts.slice(1).join("/")}` : "/register";
  else if (path === "/workbench")
    path = url.searchParams.get("case")
      ? `/workspace/${encodeURIComponent(url.searchParams.get("case")!)}/geometry`
      : "/workspace";
  return studioProductUrl(path + url.search + url.hash);
}
export type RouteSearchParams = Record<string, string | string[] | undefined>;
export function withRouteQuery(path: string, values: RouteSearchParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else if (value !== undefined) search.append(key, value);
  }
  return path + (search.size ? "?" + search : "");
}
export function rootPresentationUrl(values: RouteSearchParams) {
  return legacyUrl(withRouteQuery("/", values));
}
