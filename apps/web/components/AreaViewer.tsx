"use client";
import { MapViewport } from "@/features/spatial/MapViewport";
import type { AreaViewerProps } from "@/features/spatial/layers/AreaLayer";
export type { AreaViewerProps, AreaNavigation, SceneDetail, SceneBoundary } from "@/features/spatial/layers/AreaLayer";
export default function AreaViewer(props: AreaViewerProps) { return <MapViewport source={{ kind: "area", props }} />; }
