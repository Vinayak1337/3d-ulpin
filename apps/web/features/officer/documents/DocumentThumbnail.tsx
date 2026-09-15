"use client";
import { useSourceRaster } from "../workspace/useSourceRaster";
import type { CanvasSource } from "../workspace/types";
import { Icon } from "../shared/ui";
import "./documents.css";
export function documentLabel(name: string) {
  const floor = name.match(/-floor-(\d+)\.png$/i);
  if (floor)
    return Number(floor[1]) === 0 ? "Ground floor" : `Floor ${floor[1]}`;
  if (/floor-plans\.pdf$/i.test(name)) return "Floor plan set";
  if (/authored-spaces\.csv$/i.test(name)) return "Space & level schedule";
  return name;
}
export default function DocumentThumbnail({
  source,
}: {
  source: CanvasSource;
}) {
  const raster = useSourceRaster(source.kind === "pdf" ? source : undefined, 1);
  const url = source.kind === "image" ? source.url : raster.url;
  return (
    <span
      className="document-thumbnail"
      data-preview={
        source.kind === "pdf" || source.kind === "image" ? "image" : "document"
      }
    >
      {url ? (
        <img src={url} alt={`Preview of ${source.name}`} loading="lazy" />
      ) : (
        <Icon
          name={source.kind === "geometry" ? "layers" : "document"}
          size={24}
        />
      )}
    </span>
  );
}
