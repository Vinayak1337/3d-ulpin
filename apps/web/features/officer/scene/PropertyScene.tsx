"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AreaContext, BuildingDossier } from "@ulpin/contracts";
import type { AreaNavigation, SceneDetail } from "@/components/AreaViewer";
import { useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import { LoadingState, ErrorState } from "../shared/ui";
import "./scene.css";
import OrbitControl from "./OrbitControl";
import BuildingPreview from "./BuildingPreview";
import SectionView from "../../spatial/SectionView";
import {recordGeometry} from "../register/model";
import type {SectionBody} from "../../spatial/data/section";
import {useQueryState} from "../shared/hooks";
const AreaViewer = dynamic(() => import("@/components/AreaViewer"), {
  ssr: false,
  loading: () => <LoadingState label="Opening building" />,
});
function InteractivePropertyScene({
  dossier,
  selectedId,
  onSelect,
  compact = false,
}: {
  dossier: BuildingDossier;
  selectedId?: string;
  onSelect?: (id: string) => void;
  compact?: boolean;
}) {
  const context = useResource<AreaContext>(`/areas/${dossier.area.id}/context`);
  const router = useRouter();
  const [interior, setInterior] = useState(
    !compact && dossier.detailedScene.some((d) => d.record.kind === "space"),
  );
  const [explode, setExplode] = useState(1.8);
  const [sceneMode,setSceneMode]=useQueryState("scene",["model","section"] as const,"model");
  const sectionBodies=useMemo<SectionBody[]>(()=>{const spaces=dossier.detailedScene.filter(d=>d.record.kind==='space');return (spaces.length?spaces:dossier.detailedScene.filter(d=>d.record.kind==='floor')).filter(d=>Number.isFinite(d.lower)&&Number.isFinite(d.upper)&&!!d.verticalReference).map(d=>({id:d.record.id,label:d.record.name,geometry:recordGeometry(dossier,d.record),lower:d.lower!,upper:d.upper!,reference:d.verticalReference!}));},[dossier]);
  const [navigation, setNavigation] = useState<AreaNavigation>({
    action: "focus",
    sequence: 0,
  });
  const details = useMemo<SceneDetail[]>(
    () =>
      dossier.detailedScene
        .filter(
          (d) =>
            d.record.kind === "space" &&
            d.geographicGeometry &&
            Number.isFinite(d.lower) &&
            Number.isFinite(d.upper),
        )
        .map((d) => ({
          id: d.record.id,
          name: d.record.name,
          kind: "space",
          geographicGeometry: d.geographicGeometry!,
          localGeometry: d.localGeometry,
          lower: d.lower!,
          upper: d.upper!,
          verticalReference: d.verticalReference,
        })),
    [dossier],
  );
  const selectedSpaces = useMemo(
    () =>
      dossier.records
        .filter(
          (record) =>
            record.kind === "space" &&
            (record.id === selectedId ||
              record.links.some(
                (link) => link.type === "floor" && link.targetId === selectedId,
              )),
        )
        .map((record) => record.id),
    [dossier.records, selectedId],
  );
  const floors = dossier.records.filter((r) => r.kind === "floor");
  return (
    <section
      className={`property-scene ${compact ? "property-scene--compact" : ""}`}
      aria-label={`${dossier.building.name} in its block`}
    >
      {!compact && (
        <div className="property-scene-tools">
          <div className="property-scene-switch">
            <button aria-pressed={sceneMode==='model'&&!interior} onClick={() => {setSceneMode('model');setInterior(false);}}>
              Building
            </button>
            <button
              aria-pressed={sceneMode==='model'&&interior}
              disabled={!details.length}
              onClick={() => {setSceneMode('model');setInterior(true);}}
            >
              Floors & spaces
            </button>
            <button aria-pressed={sceneMode==='section'} onClick={()=>setSceneMode('section')}>Section</button>
          </div>
          <OrbitControl
            onNavigate={(action) =>
              setNavigation((n) => ({ action, sequence: n.sequence + 1 }))
            }
          />
        </div>
      )}
      {sceneMode==='section'&&<SectionView bodies={sectionBodies} selectedId={selectedId} onSelect={onSelect}/>}
      <div className="property-scene-runtime" style={{height:'100%',minHeight:250,display:sceneMode==='section'?'none':'block'}}>
      {context.error ? (
        <ErrorState message={context.error} retry={context.reload} />
      ) : context.data ? (
        <AreaViewer
          key={dossier.building.id}
          features={context.data.features}
          sceneAssets={context.data.sceneAssets}
          selectedId={dossier.building.id}
          framingFeatureId={dossier.building.id}
          frameScale={5.2}
          onSelect={(id) => {
            if (
              id !== dossier.building.id &&
              context.data?.features.some(
                (f) => f.id === id && f.kind === "building",
              )
            )
              router.push(routes.register(id, dossier.area.id));
          }}
          navigation={navigation}
          sceneKey={`floor-stack:${dossier.building.id}`}
          details={interior ? details : []}
          selectedDetailId={selectedId}
          selectedDetailIds={selectedSpaces}
          onSelectDetail={onSelect}
          explode={interior ? explode : 0}
          detailStyle="floorplan"
          labels={false}
        />
      ) : (
        <LoadingState label="Loading block context" />
      )}
      </div>
      {!compact && sceneMode!=='section' && (
        <div className="property-scene-footer">
          {interior ? (
            <>
              <span>
                {floors.length} floors · {details.length} spaces
              </span>
              <label>
                Separate floors{" "}
                <input
                  aria-label="Floor separation (display only)"
                  type="range"
                  min="0"
                  max="4"
                  step=".2"
                  value={explode}
                  onChange={(e) => setExplode(Number(e.target.value))}
                />
              </label>
              <small>Display separation only · levels unchanged</small>
            </>
          ) : (
            <span>
              {dossier.building.worldStatus === "synthetic"
                ? "Fictional demonstration"
                : "Source-supported exterior"}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

export default function PropertyScene(
  props: Parameters<typeof InteractivePropertyScene>[0],
) {
  return props.compact ? (
    <BuildingPreview feature={props.dossier.building} />
  ) : (
    <InteractivePropertyScene {...props} />
  );
}
