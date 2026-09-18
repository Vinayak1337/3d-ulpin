import { SPATIAL_SCHEMA, type SpatialSnapshot, type SpatialEntity, type SpatialRepresentation, type SpatialRelation, type XY } from "@ulpin/contracts";
export type CalibrationKind = "garden" | "dense";
const rectangle = (x: number, y: number, w: number, d: number): XY[] => [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]];
/** Authored synthetic inputs. The compiler does not know which locality/fixture it is rendering. */
export function calibrationSnapshot(kind: CalibrationKind = "garden"): SpatialSnapshot {
    const worldId = `calibration-${kind}`, frameId = `${worldId}:enu`;
    const entities: SpatialEntity[] = [], representations: SpatialRepresentation[] = [], relations: SpatialRelation[] = [];
    const add = (key: string, entityKind: SpatialEntity["kind"], geometry: SpatialRepresentation["geometry"], role: SpatialRepresentation["role"], lower: number, upper: number, appearance?: SpatialRepresentation["appearance"]) => {
        const id = `${worldId}:${key}`, rid = `${id}:geometry`;
        entities.push({ id, revision: 1, worldId, kind: entityKind, label: key.replaceAll("-", " "), identifiers: [{ scheme: "prototype", issuer: "3d-ulpin-calibration", value: id, status: "prototype" }], areaIds: [`${worldId}:west`, `${worldId}:east`].filter((_, i) => { const p = geometry.type === "Point" ? geometry.coordinates : geometry.type === "Polygon" ? geometry.coordinates[0][0] : [0, 0]; return i === 0 ? p[0] < 40 : p[0] > -40; }), representationIds: [rid] });
        representations.push({ id: rid, revision: 1, entityId: id, frameId, role, geometry, vertical: { lower, upper, reference: "authored-local-grade" }, evidence: [{ sourceId: `${worldId}:source`, sourceRevision: 1, locator: { kind: "manual", value: key } }], ...(appearance ? { appearance } : {}) });
        return id;
    };
    const size = kind === "garden" ? 292 : 210;
    add("ground", "terrain", { type: "Polygon", coordinates: [rectangle(-size / 2, -size / 2, size, size)] }, "terrain_surface", -0.22, -0.02);
    if (kind === "garden") {
        for (let n = -2; n <= 2; n++) {
            add(`road-east-${n + 2}`, "road", { type: "Polygon", coordinates: [rectangle(-146, n * 70 - 4.8, 292, 9.6)] }, "road_surface", 0, 0.055);
            add(`road-north-${n + 2}`, "road", { type: "Polygon", coordinates: [rectangle(n * 70 - 4.8, -146, 9.6, 292)] }, "road_surface", 0, 0.055);
        }
        let number = 0, tree = 0;
        for (let by = -2; by < 2; by++)
            for (let bx = -2; bx < 2; bx++) {
                const ox = bx * 70 + 35, oy = by * 70 + 35;
                if (bx === -1 && by === -1) {
                    add("park", "public_land", { type: "Polygon", coordinates: [rectangle(ox - 27, oy - 27, 54, 54)] }, "public_land", 0.06, 0.13);
                    add("park-path", "road", { type: "Polygon", coordinates: [rectangle(ox - 27, oy - 1.3, 54, 2.6)] }, "road_surface", 0.14, 0.16);
                    for (let i = 0; i < 16; i++) {
                        const angle = i * Math.PI / 8;
                        add(`tree-${++tree}`, "vegetation", { type: "Point", coordinates: [ox + 22 * Math.cos(angle), oy + 22 * Math.sin(angle)] }, "display_only", 0.15, 5.5 + (i % 3));
                    }
                    continue;
                }
                for (let iy = 0; iy < 2; iy++)
                    for (let ix = 0; ix < 2; ix++) {
                        const x = ox + (ix ? 5 : -26), y = oy + (iy ? 5 : -26), w = 19 + (number % 3), d = 19 + ((number + 1) % 3), storeys = 3 + (number % 3);
                        add(`parcel-${number + 1}`, "parcel", { type: "Polygon", coordinates: [rectangle(x - 1.7, y - 1.7, w + 3.4, d + 3.4)] }, "recorded_parcel", 0.055, 0.07);
                        add(`building-${++number}`, "building", { type: "Polygon", coordinates: [rectangle(x, y, w, d)] }, "ground_footprint", 0.07, storeys * 3.2 + 0.07, { facade: "schematic", storeys, roof: number % 2 ? "flat" : "terrace" });
                        add(`tree-${++tree}`, "vegetation", { type: "Point", coordinates: [x + w + 2.1, y - 1] }, "display_only", 0.08, 5.2 + (number % 3));
                    }
            }
    }
    else {
        for (let j = 0; j < 10; j++)
            for (let i = 0; i < 12; i++) {
                const n = j * 12 + i + 1, x = -90 + i * 15, y = -74 + j * 15, w = 11.4 + (n % 3) * 0.45, d = 11.1 + (n % 4) * 0.5, floors = 2 + (n % 4);
                const polygon = n % 11 === 0 ? [[x, y], [x + w, y], [x + w, y + d / 2], [x + w - 3, y + d / 2], [x + w - 3, y + d], [x, y + d], [x, y]] as XY[] : rectangle(x, y, w, d);
                add(`building-${n}`, "building", { type: "Polygon", coordinates: [polygon] }, "ground_footprint", 0.05, 0.05 + floors * 3.1, { facade: "schematic", storeys: floors, roof: "flat" });
            }
        for (let n = 0; n < 11; n++)
            add(`lane-east-${n}`, "road", { type: "Polygon", coordinates: [rectangle(-96, -77 + n * 15, 190, 2.6)] }, "road_surface", 0, 0.04);
        for (let n = 0; n < 13; n++)
            add(`lane-north-${n}`, "road", { type: "Polygon", coordinates: [rectangle(-93 + n * 15, -79, 2.6, 165)] }, "road_surface", 0, 0.04);
    }
    // One real fixture hierarchy. These are not inferred interiors for the other buildings.
    const building = entities.find(e => e.kind === "building")!, rep = representations.find(r => r.entityId === building.id)!;
    const ring = (rep.geometry as {
        type: "Polygon";
        coordinates: readonly (readonly XY[])[];
    }).coordinates[0];
    const x = ring[0][0], y = ring[0][1], w = ring[1][0] - x, d = ring[2][1] - y, storeys = rep.appearance!.storeys!, floorHeight = (rep.vertical!.upper - rep.vertical!.lower) / storeys;
    for (let floor = 0; floor < storeys; floor++) {
        const lower = rep.vertical!.lower + floor * floorHeight, upper = lower + floorHeight;
        const level = add(`building-1-level-${floor}`, "level", { type: "Polygon", coordinates: [rectangle(x, y, w, d)] }, "floor_boundary", lower, upper);
        relations.push({ id: `${level}:parent`, fromId: level, toId: building.id, kind: "part_of" });
        for (let unit = 0; unit < 2; unit++) {
            const id = add(`building-1-level-${floor}-unit-${unit + 1}`, "space", { type: "Polygon", coordinates: [rectangle(x + 0.3 + unit * w / 2, y + 0.3, w / 2 - 0.6, d - 0.6)] }, "unit_boundary", lower, upper);
            relations.push({ id: `${id}:parent`, fromId: id, toId: building.id, kind: "part_of" }, { id: `${id}:level`, fromId: id, toId: level, kind: "occupies_level" });
        }
    }
    return { schemaVersion: SPATIAL_SCHEMA, id: `${worldId}:snapshot`, revision: 1, worldId, worldState: "synthetic", frames: [{ id: frameId, kind: "engineering", horizontalUnit: "m", verticalUnit: "m", axes: "east-north-up", verticalReference: "authored-local-grade", anchor: { longitude: 77.05, latitude: 28.62, ellipsoidHeight: 0, provenance: "Authored demonstration placement; not a surveyed locality or ground height" } }], sources: [{ id: `${worldId}:source`, revision: 1, label: "Authored calibration vectors and level schedule", method: "synthetic" }], entities, representations, relations, attachments: [] };
}
