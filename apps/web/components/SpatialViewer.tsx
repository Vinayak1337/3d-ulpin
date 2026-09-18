"use client";
import { MapViewport } from "@/features/spatial/MapViewport";
import type { LocalModelProps } from "@/features/spatial/layers/LocalModelLayer";
export default function SpatialViewer(props: LocalModelProps) { return <MapViewport source={{ kind: "local-model", props }} />; }
