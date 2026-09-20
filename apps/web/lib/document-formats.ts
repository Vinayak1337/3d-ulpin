/** Shared receipt and assignment capabilities. Extensions are suggestions; services inspect bytes. */
export const documentFormats = ["pdf", "png", "jpeg", "csv", "text", "docx"] as const;
export type DocumentFormat = typeof documentFormats[number];
export const documentAccept = ".pdf,.png,.jpg,.jpeg,.csv,.txt,.docx";
export const documentProfileFormats: Record<string, DocumentFormat> = {
  "plan-pdf-v1": "pdf", "plan-png-v1": "png", "levels-csv-v1": "csv",
  ...Object.fromEntries(documentFormats.map(format => [`${format}-reference-v2`, format])),
};
export function documentFormat(name: string): DocumentFormat | undefined {
  const extension = name.split(".").at(-1)?.toLowerCase();
  const format = extension === "jpg" ? "jpeg" : extension === "txt" ? "text" : extension;
  return documentFormats.includes(format as DocumentFormat) ? format as DocumentFormat : undefined;
}
export function documentLimitMiB(format: DocumentFormat): number {
  return format === "png" || format === "jpeg" ? 16 : 10;
}
export function documentSizeError(file: {name: string; size: number}): string | undefined {
  const format = documentFormat(file.name);
  if (!format) return undefined;
  const limit = documentLimitMiB(format);
  if (file.size === 0) return `${file.name} is empty. Choose a nonempty ${format.toUpperCase()} file.`;
  if (file.size > limit * 1024 * 1024) return `${file.name} exceeds the ${limit} MiB ${format.toUpperCase()} limit. Remove it and choose a smaller file.`;
  return undefined;
}
