/** Presentation routes only. API, external, fragment and V2 URLs are unchanged. */
export function legacyUrl(url: string): string {
  if (url === "/") return "/legacy";
  if (url.startsWith("/?") || url.startsWith("/#")) return "/legacy" + url.slice(1);
  if (/^\/(areas|properties|registry|workbench|sites)(?=[/?#]|$)/.test(url))
    return "/legacy" + url;
  return url;
}

export type RouteSearchParams = Record<string, string | string[] | undefined>;
export function withRouteQuery(path: string, values: RouteSearchParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
    else if (value !== undefined) search.append(key, value);
  }
  return path + (search.size ? `?${search}` : "");
}

export function rootPresentationUrl(values: RouteSearchParams): string {
  return withRouteQuery(Object.hasOwn(values, "case") ? "/legacy" : "/v2", values);
}
