import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type {
  AreaGeometry,
  MapArea,
  PhysicalFeature,
  RegistryRecord,
} from "../packages/contracts/src/index";
import {
  createV2Store,
  hydrateV2Store,
  parseV2Navigation,
  type RecentProperty,
} from "../apps/web/features/v2/shared/store";
import { routes } from "../apps/web/features/v2/shared/routes";
import {
  searchTargets,
  searchTargetRoute,
  type ResolveMatch,
} from "../apps/web/features/v2/shared/search-targets";
import {
  featureBounds,
  geometryPath,
  geometryPoints,
  geometryPrimitives,
} from "../apps/web/features/v2/block/geometry";
import {
  navigationRequest,
  validatedNavigationTargets,
} from "../apps/web/features/v2/shared/navigation-targets";

const property = (index: number, area = "area-A"): RecentProperty => ({
  buildingId: `building-${index}`,
  areaId: area,
  name: `Property ${index}`,
  identifier: `ID-${index}`,
  areaName: `Block ${area}`,
});

test("mixed finding geometry retains polygon holes, open contacts and every point", () => {
  const primitives = geometryPrimitives({
    type: "GeometryCollection",
    geometries: [
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 0],
          ],
          [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 2],
          ],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [1, 1],
          [2, 3],
          [4, 1],
        ],
      },
      {
        type: "MultiPoint",
        coordinates: [
          [2, 4],
          [6, 8],
        ],
      },
    ],
  });
  assert.deepEqual(
    primitives.map((item) => item.kind),
    ["polygon", "line", "point", "point"],
  );
  assert.equal(
    primitives[0].kind === "polygon" && primitives[0].path.match(/Z/g)?.length,
    2,
  );
  assert.equal(
    primitives[1].kind === "line" && primitives[1].path.includes("Z"),
    false,
    "A contact line cannot enclose a invented collision area.",
  );
  assert.deepEqual(primitives.slice(2), [
    { kind: "point", point: [2, 4] },
    { kind: "point", point: [6, 8] },
  ]);
});
function feature(
  id: string,
  areaId: string,
  kind: PhysicalFeature["kind"] = "building",
): PhysicalFeature {
  return {
    id,
    areaId,
    kind,
    name: `Property ${id}`,
    identifier: `ID-${id}`,
  } as PhysicalFeature;
}

test("independent layout stores retain coherent selection and bounded recency through block switches", () => {
  const first = createV2Store(),
    second = createV2Store();
  first.getState().selectBlock("area-A", "Block A");
  for (let index = 0; index < 15; index++)
    first.getState().selectProperty(property(index));
  first
    .getState()
    .setMapPreferences("area-A", { hiddenLayers: ["utility"], mode: "2d" });
  first
    .getState()
    .selectProperty({ ...property(5, "area-B"), name: "Renamed property" });
  assert.equal(first.getState().recentProperties.length, 12);
  assert.deepEqual(
    first.getState().recentProperties.map((item) => item.buildingId),
    [5, 14, 13, 12, 11, 10, 9, 8, 7, 6, 4, 3].map(
      (index) => `building-${index}`,
    ),
  );
  assert.equal(first.getState().recentProperties[0].name, "Renamed property");
  assert.equal(first.getState().selectedAreaId, "area-B");
  first.getState().selectBlock("area-B", "Renamed block");
  assert.equal(first.getState().selectedBuildingId, "building-5");
  first.getState().selectBlock("area-C");
  assert.equal(
    first.getState().selectedBuildingId,
    null,
    "A new block cannot retain a building from the old block.",
  );
  first
    .getState()
    .selectProperty({ ...property(1, "area-D"), areaName: undefined });
  assert.equal(
    first.getState().areaName,
    "",
    "A property without an area label cannot inherit another block's name.",
  );
  assert.equal(second.getState().selectedAreaId, null);
  assert.deepEqual(second.getState().recentProperties, []);
  assert.deepEqual(second.getState().mapPreferences, {});
});

test("versioned browser storage rejects malformed state and projects only safe recent fields", () => {
  for (const raw of [
    null,
    "{bad",
    "null",
    "[]",
    JSON.stringify({ version: 2, recentProperties: [property(1)] }),
    " ".repeat(1024 * 1024 + 1),
  ]) {
    const parsed = parseV2Navigation(raw);
    assert.equal(parsed.selectedBuildingId, null);
    assert.deepEqual(parsed.recentProperties, []);
  }
  const parsed = parseV2Navigation(
    JSON.stringify({
      version: 1,
      selectedAreaId: "area-A",
      selectedBuildingId: "building-1",
      mapPreferences: { "area-A": { mode: "unsafe" } },
      recentProperties: [
        null,
        {
          ...property(1),
          areaName: { malformed: true },
          selectProperty: "replace-action",
          sourceBytes: "never retain this",
        },
        { ...property(1), name: "Duplicate" },
        { ...property(2), name: 9 },
        { ...property(3), buildingId: "" },
      ],
    }),
  );
  assert.deepEqual(parsed.recentProperties, [
    {
      buildingId: "building-1",
      areaId: "area-A",
      name: "Property 1",
      identifier: "ID-1",
    },
  ]);
  assert.equal(parsed.selectedBuildingId, "building-1");
  assert.equal(parsed.areaName, "");
  const mismatched = parseV2Navigation(
    JSON.stringify({
      selectedAreaId: "area-B",
      selectedBuildingId: "building-1",
      recentProperties: [property(1)],
    }),
  );
  assert.equal(
    mismatched.selectedBuildingId,
    null,
    "Independently persisted IDs cannot form an unsupported area/property pair.",
  );
});

test("hydration preserves a route-driven selection and safely restores a separate new layout", () => {
  const saved = JSON.stringify({
    version: 1,
    selectedAreaId: "area-old",
    selectedBuildingId: "building-4",
    recentProperties: [
      property(4, "area-old"),
      ...Array.from({ length: 20 }, (_, index) => property(index)),
    ],
  });
  const live = createV2Store();
  live.getState().selectProperty({
    ...property(4, "area-current"),
    name: "Current route property",
  });
  live.getState().setMapPreferences("area-current", { underground: true });
  hydrateV2Store(live, saved);
  assert.equal(live.getState().selectedAreaId, "area-current");
  assert.equal(live.getState().selectedBuildingId, "building-4");
  assert.equal(
    live.getState().recentProperties[0].name,
    "Current route property",
  );
  assert.equal(live.getState().recentProperties.length, 12);
  assert.equal(
    new Set(live.getState().recentProperties.map((item) => item.buildingId))
      .size,
    12,
  );
  assert.equal(
    live.getState().mapPreferences["area-current"].underground,
    true,
  );
  assert.equal(live.getState().hydrated, true);
  const resumed = createV2Store();
  hydrateV2Store(resumed, saved);
  assert.equal(resumed.getState().selectedAreaId, "area-old");
  assert.equal(resumed.getState().selectedBuildingId, "building-4");
  assert.equal(resumed.getState().areaName, "Block area-old");
  assert.deepEqual(resumed.getState().mapPreferences, {});
});

test("navigation preserves encoded physical and record identities without rewriting evidence endpoints", () => {
  const area = "area/with ?&+",
    building = "building/देवनागरी?&+",
    record = "unit/#1 ?&+";
  const target = {
    id: building,
    areaId: area,
    kind: "building" as const,
    name: "Example",
    identifier: "ID",
    recordId: record,
  };
  for (const family of ["block", "register", "workspace"] as const) {
    const url = new URL(searchTargetRoute(target, family), "http://local");
    assert.equal(url.searchParams.get("record"), record);
    assert.equal(url.searchParams.size, 2);
    if (family === "block") {
      assert.equal(decodeURIComponent(url.pathname.split("/").at(-1)!), area);
      assert.equal(url.searchParams.get("feature"), building);
    } else {
      assert.equal(
        decodeURIComponent(url.pathname.split("/").at(-2)!),
        building,
      );
      assert.equal(url.searchParams.get("area"), area);
    }
  }
  assert.equal(
    routes.source("source/1?x=y"),
    "/api/v1/sources/source%2F1%3Fx%3Dy/file",
  );
  assert.equal(routes.block(null, building), "/v2");
});

test("shared basement lookup offers each physical parent and never pairs first parent with another parent's area", () => {
  const a = feature("A", "owner-A"),
    b = feature("B", "owner-B");
  const match: ResolveMatch = {
    kind: "registry_record",
    feature: a,
    record: { id: "shared-basement", name: "Shared basement" },
    areaIds: ["owner-A", "owner-B"],
    relatedBuildings: [{ feature: a }, { feature: b }],
  };
  const targets = searchTargets(match, "owner-B");
  assert.deepEqual(
    targets.map((target) => [target.id, target.areaId, target.recordId]),
    [
      ["A", "owner-A", "shared-basement"],
      ["B", "owner-B", "shared-basement"],
    ],
  );
  assert.equal(
    targets.length,
    2,
    "Duplicate first-parent representations do not duplicate the choices.",
  );
  for (const target of targets)
    assert.equal(
      new URL(
        searchTargetRoute(target, "register"),
        "http://local",
      ).searchParams.get("record"),
      "shared-basement",
    );
  const member = searchTargets(match, "member-block", {
    areaId: "member-block",
    featureIds: ["A"],
  });
  assert.deepEqual(
    member.map((target) => [target.id, target.areaId]),
    [
      ["A", "member-block"],
      ["B", "owner-B"],
    ],
  );
  const stale = searchTargets(match, "new-selection", {
    areaId: "member-block",
    featureIds: ["A", "B"],
  });
  assert.deepEqual(
    stale.map((target) => target.areaId),
    ["owner-A", "owner-B"],
    "A response for an old selected block does not authorize current membership.",
  );
});

test("parcel intersections and legacy registry IDs do not become canonical building choices", () => {
  const parcel = feature("P", "area-A", "parcel"),
    building = feature("B", "area-A");
  const targets = searchTargets(
    {
      kind: "physical_feature",
      feature: parcel,
      areaIds: ["area-A"],
      relatedBuildings: [{ feature: building }],
    },
    "area-A",
  );
  assert.deepEqual(
    targets.map((target) => [target.kind, target.id]),
    [["feature", "P"]],
  );
  assert.equal(
    new URL(
      searchTargetRoute(targets[0], "workspace"),
      "http://local",
    ).searchParams.get("feature"),
    "P",
  );
  assert.deepEqual(
    searchTargets({
      kind: "registry_record",
      areaIds: ["area-A"],
      relatedBuildings: [{ id: "legacy-unlinked-building" }],
      record: { id: "unit" },
    }),
    [],
  );
  assert.deepEqual(
    searchTargets({
      kind: "site",
      areaIds: ["area-A"],
      site: { id: "site-A", name: "Area A" },
    }).map((target) => [target.kind, target.areaId]),
    [["area", "area-A"]],
  );
});

test("header navigation rejects an unrelated query block and stale stored property before and after dossier loading", () => {
  const stored = { buildingId: "A", areaId: "old-block" };
  const request = navigationRequest(
    "/v2/properties/B/register",
    new URLSearchParams("area=bronx&record=room-B"),
    stored,
  );
  const pending = validatedNavigationTargets(request, {});
  assert.equal(
    pending.workspace,
    "/v2/properties/B/workspace",
    "The current route wins over saved A while its owner is unknown.",
  );
  assert.equal(
    pending.block,
    "/v2",
    "An unverified query block is never paired with B.",
  );
  const dossier = {
    canonicalBuildingId: "B",
    building: feature("B", "synthetic"),
    area: { id: "synthetic" } as MapArea,
    records: [{ id: "room-B" } as RegistryRecord],
  };
  const unrelated = {
    area: { id: "bronx" } as MapArea,
    features: [feature("real-building", "bronx")],
  };
  const targets = validatedNavigationTargets(request, {
    dossier,
    context: unrelated,
  });
  assert.equal(targets.block, "/v2/blocks/synthetic?feature=B&record=room-B");
  assert.equal(
    targets.register,
    "/v2/properties/B/register?area=synthetic&record=room-B",
  );
  assert.equal(
    targets.workspace,
    "/v2/properties/B/workspace?area=synthetic&record=room-B",
  );
  const wrongDossier = {
    ...dossier,
    canonicalBuildingId: "A",
    building: feature("A", "old-block"),
  };
  assert.equal(
    validatedNavigationTargets(request, {
      dossier: wrongDossier,
      context: unrelated,
    }).block,
    "/v2",
  );
  assert.equal(
    validatedNavigationTargets({ ...request, recordId: "room-A" }, { dossier })
      .recordId,
    null,
    "Only this dossier's actual record IDs enter header links.",
  );
});

test("header accepts actual cross-block membership, handles areaId alias and never makes a parcel a building", () => {
  const request = navigationRequest(
    "/v2/properties/B/workspace",
    new URLSearchParams("areaId=member-block"),
    { areaId: null, buildingId: null },
  );
  const dossier = {
    canonicalBuildingId: "B",
    building: feature("B", "owner"),
    area: { id: "owner" } as MapArea,
    records: [],
  };
  const context = {
    area: { id: "member-block" } as MapArea,
    features: [feature("B", "owner")],
  };
  assert.equal(
    validatedNavigationTargets(request, { dossier, context }).block,
    "/v2/blocks/member-block?feature=B",
  );
  assert.equal(
    validatedNavigationTargets(request, {
      dossier,
      context: { ...context, area: { id: "stale-block" } as MapArea },
    }).block,
    "/v2/blocks/owner?feature=B",
  );
  const parcelRequest = navigationRequest(
    "/v2/blocks/member-block",
    new URLSearchParams("feature=P"),
    { areaId: "owner", buildingId: "B" },
  );
  const parcel = validatedNavigationTargets(parcelRequest, {
    context: { ...context, features: [feature("P", "member-block", "parcel")] },
  });
  assert.equal(parcel.block, "/v2/blocks/member-block?feature=P");
  assert.equal(parcel.register, "/v2/register");
  assert.equal(parcel.workspace, "/v2/workspace");
  assert.equal(
    navigationRequest(
      "/v2/properties/%E0%A4%A/register",
      new URLSearchParams(),
      { areaId: "owner", buildingId: "B" },
    ).candidateId,
    null,
    "Malformed route encoding cannot crash or inherit another property.",
  );
});

test("plan geometry keeps independent rings, multipart islands and line contacts with a display-only y flip", () => {
  const polygon: AreaGeometry = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [2, 4],
          [4, 4],
          [4, 2],
          [2, 2],
        ],
      ],
      [
        [
          [20, 0],
          [22, 0],
          [22, 2],
          [20, 2],
          [20, 0],
        ],
      ],
    ],
  };
  const collection: AreaGeometry = {
    type: "GeometryCollection",
    geometries: [
      polygon,
      {
        type: "LineString",
        coordinates: [
          [10, 2],
          [10, 7],
        ],
      },
      { type: "Point", coordinates: [10, 7] },
    ],
  };
  const path = geometryPath(collection);
  assert.equal(
    (path.match(/ Z/g) || []).length,
    3,
    "Each outer/hole/island ring remains separate; a line is not closed.",
  );
  assert(path.trimEnd().endsWith("M10,-2 L10,-7"));
  assert.deepEqual(geometryPoints(collection).at(-1), [10, 7]);
  assert.deepEqual(
    polygon.coordinates[0][1][0],
    [2, 2],
    "Display conversion never mutates the source geometry.",
  );
  const bounds = featureBounds([
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [10, 20],
          [30, 50],
        ],
      },
    } as PhysicalFeature,
  ]);
  assert.deepEqual(bounds, [6.4, -53.6, 27.2, 37.2]);
});

test("actual React resource hook ignores stale refreshes and callbacks from a previous property", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))(
    "esbuild",
  );
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../apps/web", import.meta.url)),
      loader: "tsx",
      contents: `
      import React, {act,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useResource} from './features/v2/shared/hooks';
      window.IS_REACT_ACT_ENVIRONMENT = true;
      window.pending = [];
      window.fetch = (url,options={}) => new Promise(resolve=>window.pending.push({url,signal:options.signal,resolve}));
      const root = createRoot(document.getElementById('root'));
      function Harness({path}) { const resource=useResource(path); useEffect(()=>{window.resource=resource}); return <div>{resource.data?.id || 'empty'}</div>; }
      window.harness = {
        render: async path=>act(()=>root.render(<Harness path={path}/>)),
        settle: async (index,value)=>act(async()=>{window.pending[index].resolve({ok:true,status:200,json:async()=>value});}),
        run: async callback=>act(callback),
        unmount: async ()=>act(()=>root.unmount()),
      };
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "unused-next-navigation",
        setup(builder: any) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "navigation",
            namespace: "unit-test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "unit-test" }, () => ({
            contents:
              "export const usePathname=()=>'',useRouter=()=>({}),useSearchParams=()=>new URLSearchParams();",
            loader: "js",
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      const w = window as any;
      await w.harness.render("/property-A");
      await w.harness.settle(0, { id: "A", revision: 1 });
      w.oldA = w.resource;
    });
    await page.evaluate(async () => {
      const w = window as any;
      await w.harness.run(() => {
        void w.resource.reload();
      });
      await w.harness.run(() => w.resource.setData({ id: "A", revision: 2 }));
      await w.harness.settle(1, { id: "A", revision: 1 });
    });
    assert.deepEqual(
      await page.evaluate(() => {
        const w = window as any;
        return { data: w.resource.data, aborted: w.pending[1].signal.aborted };
      }),
      { data: { id: "A", revision: 2 }, aborted: true },
      "Even a transport ignoring abort cannot overwrite the authoritative mutation response.",
    );
    await page.evaluate(async () => {
      const w = window as any;
      await w.harness.render("/property-B");
      await w.harness.run(async () => {
        await w.oldA.reload();
        w.oldA.setData({ id: "A", revision: 99 });
      });
    });
    assert.deepEqual(
      await page.evaluate(() => {
        const w = window as any;
        return {
          requests: w.pending.length,
          aborted: w.pending[2].signal.aborted,
          data: w.resource.data,
          loading: w.resource.loading,
        };
      }),
      { requests: 3, aborted: false, data: null, loading: true },
      "Old property callbacks cannot abort or populate the current property's request.",
    );
    await page.evaluate(async () => {
      const w = window as any;
      await w.harness.settle(2, { id: "B", revision: 1 });
      w.oldB = w.resource;
      await w.harness.unmount();
      await w.oldB.reload();
      w.oldB.setData({ id: "B", revision: 2 });
    });
    assert.equal(
      await page.evaluate(() => (window as any).pending.length),
      3,
      "Unmounted callbacks cannot start extra requests.",
    );
  } finally {
    await browser.close();
  }
});
