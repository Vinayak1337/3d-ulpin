"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Document identity and page are addressable; the owning workspace validates source membership. */
export function useDocumentSelection() {
  const pathname = usePathname(),
    search = useSearchParams(),
    router = useRouter();
  const sourceId = search.get("source") || "";
  const requested = Number(search.get("page") || 1);
  const page =
    Number.isInteger(requested) && requested > 0 && requested <= 1000
      ? requested
      : 1;
  function update(source: string, page: number) {
    const next = new URLSearchParams(search.toString());
    if (source) next.set("source", source);
    else next.delete("source");
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    router.replace(`${pathname}${next.size ? "?" + next : ""}`, {
      scroll: false,
    });
  }
  return {
    sourceId,
    page,
    selectSource: (id: string, page = 1) => update(id, page),
    selectPage: (value: number) => update(sourceId, value),
  };
}
