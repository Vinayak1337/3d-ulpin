"use client";
import { useEffect,useState,useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CaseRecord,BuildingDossier,PreparationCase,MapArea } from "@ulpin/contracts";
import { request, useMutation, useResource } from "../shared/hooks";
import { routes, withQuery } from "../shared/routes";
import { useActiveRecents } from "../shared/useActiveRecents";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Panel,
} from "../shared/ui";
import { datasetLabel, filterWorkspaces, type WorkspaceSummary } from "../shared/directory";
import PropertyChooser,{type PropertyChoice} from "./PropertyChooser";
import styles from "./Workspace.module.css";
export default function WorkspaceStart() {
  const router = useRouter(),
    recent = useActiveRecents();
  const cases = useResource<WorkspaceSummary[]>("/workspace-directory");
  const areas = useResource<MapArea[]>("/areas");
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const status = params.get("status") || "all";
  useEffect(() => setQuery(params.get("q") || ""), [params]);
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if(value) next.set(key,value); else next.delete(key);
    window.history.replaceState(null, '', '/studio/workspaces'+(next.size?'?'+next:''));
  };
  const mutation = useMutation();
  const [create, setCreate] = useState(false),
    [choose, setChoose] = useState(false);
  const drafts = filterWorkspaces(cases.data || [], query, status);
  const [destination,setDestination]=useState<'property'|'unassigned'>('unassigned'),[property,setProperty]=useState<PropertyChoice|null>(null);
  const operation=useRef(crypto.randomUUID());
  return (
    <div className={styles.start}>
      <header className={styles.startHeading}>
        <div>
          <h1>Plan Workspace</h1>
          <p>Continue a saved plan or add documents in a new workspace.</p>
        </div>
        <div className={styles.directoryActions}><Button icon="building" onClick={() => setChoose(true)}>Open a property</Button><Link className="ui-button ui-button--primary" href={routes.addFiles()}>Add files</Link><Button variant="ghost" onClick={() => setCreate(true)}>Create empty workspace</Button></div>
      </header>
      <Panel
        title="Saved workspaces"
        actions={<Badge>{drafts.length} of {cases.data?.length || 0} saved</Badge>}
      >
        <div className={styles.directoryFilters}>
          <label><Icon name="search" /><input aria-label="Find a workspace" placeholder="Find a workspace or property" value={query} onChange={event => { setQuery(event.target.value); updateFilter("q",event.target.value); }} /></label>
          <select aria-label="Workspace status" value={status} onChange={event => updateFilter("status",event.target.value)}><option value="all">All workspaces</option><option value="linked">Linked to a property</option><option value="unassigned">Awaiting property assignment</option></select>
        </div>
        {cases.loading ? (
          <LoadingState label="Opening saved workspaces" />
        ) : cases.error ? (
          <ErrorState message={cases.error} retry={cases.reload} />
        ) : drafts.length ? (
          <div className={styles.draftList}>
            {drafts.map((c) => (
              <Link
                key={c.id}
                href={withQuery(routes.case(c.id), { area: c.areaId })}
              >
                <span className={styles.draftIcon}>
                  <Icon name="workspace" />
                </span>
                <span>
                  <strong>
                    {c.propertyName || c.name}
                  </strong>
                  <small>
                    {c.propertyName && c.propertyName !== c.name ? `${c.name} · ` : ""}Updated {new Date(c.updatedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })} · {datasetLabel(areas.data?.find(area => area.id === c.areaId)?.dataKind)}
                  </small>
                </span>
                <Badge>
                  {c.sourceCount} sources · {c.buildingId ? "Property linked" : "Unassigned"}
                </Badge>
                <Icon name="arrow" />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title={cases.data?.length ? "No matching workspaces" : "No saved workspaces yet"}
            description={cases.data?.length ? "Try another name or change the assignment filter." : "Create a workspace to add and review your plan documents."}
            icon="workspace"
          />
        )}
      </Panel>
      {!!recent.length && (
        <details className={styles.directoryRecents}><summary>Recently opened properties</summary>
          <div className={styles.recent}>
            {recent.slice(0, 6).map((p) => (
              <Link
                key={p.buildingId}
                href={routes.workspace(p.buildingId, p.areaId)}
              >
                <Icon name="building" />
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.identifier}</small>
                </span>
                <Icon name="arrow" />
              </Link>
            ))}
          </div>
        </details>
      )}
      <Dialog
        open={create}
        title="Create a plan workspace"
        onClose={() => setCreate(false)}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(
              new FormData(event.currentTarget).get("name"),
            ).trim();
            void mutation.run(async () => {
              if(destination==='property'){
                if(!property)throw new Error('Select a retained property first.');
                const response=await fetch(`/api/v1/buildings/${property.buildingId}/dossier`,{cache:'no-store'});if(!response.ok)throw new Error('The selected property could not be verified.');
                const dossier=await response.json() as BuildingDossier;
                if(dossier.canonicalBuildingId!==property.buildingId)throw new Error('Destination identity does not match.');
                if(!dossier.preparations.length)await request<PreparationCase>(`/buildings/${property.buildingId}/preparation-cases`,{expectedRevision:dossier.building.revision,requestKey:operation.current});
                router.push(routes.workspace(property.buildingId,property.areaId));return;
              }
              const item = await request<CaseRecord>("/cases", {
                name,
                description:
                  "Unassigned plan workspace. Originals retained; no property assigned.",
              });
              router.push(routes.case(item.id));
            });
          }}
        >
          <div className="workspace-create-choice" role="group" aria-label="Workspace destination"><Button type="button" variant={destination==='unassigned'?'primary':'secondary'} onClick={()=>setDestination('unassigned')}>Start with sources</Button><Button type="button" variant={destination==='property'?'primary':'secondary'} onClick={()=>setDestination('property')}>Link existing property</Button></div>
          {destination==='property'&&(property?<div className={styles.notice}><strong>{property.name}</strong><p>{property.identifier}</p><p>An existing preparation is reopened; a second property or parallel draft is not created.</p><Button type="button" onClick={()=>setProperty(null)}>Choose another property</Button></div>:<PropertyChooser onChoose={setProperty}/>)}
          {destination==='unassigned'&&<label>
            Workspace name
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Use the source or project name"
            />
          </label>}
          <p className={styles.muted}>
            Next, add PDF, PNG or level CSV originals. This draft does not
            create a property record.
          </p>
          {mutation.error && <ErrorState message={mutation.error} />}
          <Button type="submit" variant="primary" disabled={mutation.busy||(destination==='property'&&!property)}>
            {destination==='property'?'Open linked workspace':'Create workspace'}
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={choose}
        title="Open a property workspace"
        onClose={() => setChoose(false)}
      >
        <PropertyChooser
          onChoose={(p) =>
            router.push(routes.workspace(p.buildingId, p.areaId))
          }
        />
      </Dialog>
    </div>
  );
}
