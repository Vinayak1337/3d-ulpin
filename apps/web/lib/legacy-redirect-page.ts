import { redirect } from "next/navigation";
import {
  legacyUrl,
  withRouteQuery,
  type RouteSearchParams,
} from "./legacy-url";

export type LegacyRedirectProps = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<RouteSearchParams>;
};

export async function redirectLegacyFamily(
  family: "areas" | "properties" | "registry" | "workbench" | "sites",
  props: LegacyRedirectProps,
) {
  const [{ path = [] }, query] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const pathname = `/${family}${path.length ? "/" + path.map(encodeURIComponent).join("/") : ""}`;
  redirect(legacyUrl(withRouteQuery(pathname, query)));
}
