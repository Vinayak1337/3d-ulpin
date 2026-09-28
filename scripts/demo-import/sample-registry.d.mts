import type { BuildingResidents } from '@ulpin/api-client/draft';
export function rng(seed: string): () => number;
export function residentsFor(buildingId: string, units: { spaceId: string; unit: string; level: string }[], options?: { locale?: 'IN' | 'US'; asOf?: string; registrar?: string }): BuildingResidents;
export function layoutFor(outer: number[][], heightM: number): { floors: { index: number; label: string; lower: number; upper: number }[]; units: { name: string; ring: number[][]; areaM2: number }[]; unitsPerFloor: number } | null;
