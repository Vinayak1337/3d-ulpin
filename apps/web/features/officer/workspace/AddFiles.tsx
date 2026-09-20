"use client";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AreaContext, BuildingDossier, ImportPackage, MapArea, PreparationCase } from "@ulpin/contracts";
import { documentAccept, documentFormat, documentSizeError } from "@/lib/document-formats";
import { withQuery } from "../shared/routes";
import { request, useMutation, useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import { Button, ErrorState, Icon } from "../shared/ui";
import {intakeFileKind,type IntakeFileKind} from "@/lib/intake-file-kind";
import DatasetIntake from "./DatasetIntake";
import ImportForm from "../block/ImportForm";
import ImportReview from "../block/ImportReview";
import "../block/data-tools.css";
import "./add-files.css";

type Selection = { id: string; file: File; kind: IntakeFileKind | "checking"; error?: string; state: "selected" | "retained"; package?: ImportPackage };
export default function AddFiles() {
  const search = useSearchParams(), router = useRouter();
  const buildingId = search.get("building"), caseId = search.get("case"), contextOnly = search.get("context") === "1";
  const sourceCase = useRef<string | null>(caseId);
  const areas = useResource<MapArea[]>("/areas");
  const dossier = useResource<BuildingDossier>(buildingId ? `/buildings/${buildingId}/dossier` : null);
  const existing = useResource<ImportPackage>(caseId ? `/source-workspaces?caseId=${caseId}` : null);
  const [areaId, setAreaId] = useState(search.get("area") || ""), [origin, setOrigin] = useState("");
  const [createdArea, setCreatedArea] = useState<MapArea | null>(null);
  const [files, setFiles] = useState<Selection[]>([]), [review, setReview] = useState<ImportPackage | null>(null);
  const workspace = useRef<ImportPackage | null>(null), operation = useRef(crypto.randomUUID());
  const mutation = useMutation();
  const destinationAreaId = dossier.data?.area.id || existing.data?.areaId || areaId;
  const area = areas.data?.find(a => a.id === destinationAreaId) || (createdArea?.id === destinationAreaId ? createdArea : undefined);
  const pending = files.filter(f => f.state === "selected");
  const invalidDocument = pending.map(row => documentSizeError(row.file)).find(Boolean);
  const unsupported = pending.some(f => f.kind === "unsupported" || f.kind === "checking" || !!f.error) || !!invalidDocument;
  const gis = pending.find(f => f.kind === "gis");
  const documents = pending.filter(f => f.kind === "document");
  const retained = files.filter(f => f.state === "retained");
  function select(list: File[]) {
    const rows:Selection[]=list.map(file=>({id:crypto.randomUUID(),file,state:"selected",kind:"checking"}));
    setFiles(old=>[...old,...rows]);
    for(const row of rows)void intakeFileKind(row.file).then(kind=>setFiles(old=>old.map(item=>item.id===row.id?{...item,kind}:item))).catch(error=>setFiles(old=>old.map(item=>item.id===row.id?{...item,kind:"unsupported",error:error instanceof Error?error.message:"Unable to read file"}:item)));
  }
  async function destination() {
    if (workspace.current) return workspace.current;
    if (existing.data) return workspace.current = existing.data;
    if (buildingId) {
      if (!dossier.data || dossier.data.canonicalBuildingId !== buildingId) throw new Error("The selected property could not be verified.");
      const prep = dossier.data.preparations[0] || await request<PreparationCase>(`/buildings/${buildingId}/preparation-cases`, {expectedRevision: dossier.data.building.revision, requestKey: operation.current});
      return workspace.current = await request<ImportPackage>(`/import-packages/${prep.packageId}`);
    }
    if (!contextOnly) {
      if (!sourceCase.current) sourceCase.current = (await request<{caseId:string}>("/source-cases",{requestKey:operation.current,name:documents[0]?.file.name.replace(/\.[^.]+$/, "") || "Source review"})).caseId;
      return null;
    }
    if (!area || !origin) throw new Error("Choose a destination and declare the source origin.");
    return workspace.current = await request<ImportPackage>("/source-workspaces", {
      requestKey: operation.current, areaId: area.id, expectedAreaRevision: area.revision,
      name: documents[0]?.file.name.replace(/\.[^.]+$/, "") || "Source review", worldStatus: origin,
      ...(caseId ? {caseId} : {}),
    });
  }
  async function retainDocuments() {
    await mutation.run(async () => {
      if (invalidDocument) throw new Error(invalidDocument);
      let pkg = await destination();
      for (const selected of documents) {
        const form = new FormData(); form.set("file", selected.file); form.set("format", documentFormat(selected.file.name)!);
        if(pkg) form.set("expectedRevision", String(pkg.revision)); form.set("requestKey", selected.id);
        if (buildingId) form.set("entityIds", JSON.stringify([buildingId]));
        const endpoint = pkg ? `/api/v1/import-packages/${pkg.id}/${buildingId ? "documents" : "source-documents"}` : `/api/v1/cases/${sourceCase.current}/reference-documents`;
        const response = await fetch(endpoint, {method:"POST",body:form});
        const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || `Could not retain ${selected.file.name}`);
        if(pkg) {pkg = result; workspace.current = pkg;}
        setFiles(old => old.map(row => row.id === selected.id ? {...row,state:"retained",package:pkg || undefined} : row));
      }
      if (!pending.some(row => row.kind !== "document")) router.push(buildingId ? withQuery(routes.workspace(buildingId),{mode:"build",area:area?.id}) : withQuery(routes.case(pkg?.sourceWorkspace?.caseId || sourceCase.current!),{mode:"build",area:area?.id}));
    });
  }
  const target = workspace.current || existing.data;
  const ready = documents.length > 0 && !unsupported && !mutation.busy && !existing.loading && (!buildingId || !!dossier.data);
  return <main className="source-intake">
    <a href={routes.home} className="source-intake-back">← Work queue</a>
    <header><h1>Add files</h1><p>We will read file details and ask for what is missing.</p>
      {!dossier.data && area && <p>Context: {area.name} · documents can be retained before property assignment</p>}
      {dossier.data && <p>Destination: {dossier.data.building.name} · {dossier.data.area.name}</p>}
    </header>
    <ol className="import-progress" aria-label="Source review progress">{["Add files", "Review details", "Check & record"].map((label,i)=><li key={label} aria-current={i===0?"step":undefined}><span>{i+1}</span>{label}</li>)}</ol>
    {!contextOnly && <label className={`ui-dropzone ${files.length ? "source-intake-compact" : ""}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!mutation.busy)select(Array.from(e.dataTransfer.files));}}>
      {!files.length && <Icon name="upload" size={28}/>}<strong>{files.length ? "Add more files" : "Drop survey or plan files here"}</strong>
      <input aria-label="Survey or plan files" type="file" multiple accept={`${documentAccept},.geojson,.json,.gpkg,.zip`} disabled={mutation.busy} onChange={e=>{select(Array.from(e.target.files || []));e.target.value="";}}/>
      {!files.length && <span>Dataset ZIP / JSON: up to 20 MiB. Documents: 10 MiB. Images / raw GIS: 16 MiB.</span>}
    </label>}
    {files.length>0 && <section aria-label="Selected files" className="source-intake-files">{files.map(row=><div className="ui-intake-file" key={row.id}><Icon name="document"/><div><strong>{row.file.name}</strong><span>{row.state==="retained"?"Original retained":row.error || documentSizeError(row.file) || (row.kind==="checking"?"Reading file type…":row.kind==="dataset"?"Area dataset · review below":row.kind==="unsupported"?"Unsupported format — remove to continue":row.kind==="gis"?"GIS source · inspect and review below":`${documentFormat(row.file.name)?.toUpperCase()} · ready to read`)}</span></div>{row.state==="selected"?<Button variant="ghost" disabled={mutation.busy} onClick={()=>setFiles(old=>old.filter(f=>f.id!==row.id))}>Remove</Button>:row.kind==="gis"?<Button onClick={()=>setReview(row.package!)}>Review GIS draft</Button>:<Icon name="check"/>}</div>)}</section>}
    {(mutation.error || dossier.error || existing.error || areas.error) && <ErrorState message={mutation.error || dossier.error || existing.error || areas.error || ""}/>}
    {!buildingId && !target && contextOnly && <fieldset className="source-intake-questions" disabled={mutation.busy}><legend>Where will these sources be reviewed?</legend>
      <label>Destination block<select value={areaId} onChange={e=>setAreaId(e.target.value)}><option value="">Choose a saved block…</option>{areas.data?.map(a=><option key={a.id} value={a.id}>{a.name}{a.dataKind==="demonstration"?" · Fictional demonstration":""}</option>)}</select></label>
      <label>Source origin<select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">Declare source origin…</option><option value="observed">Real observed source</option><option value="planned">Planned source</option><option value="hypothetical">Hypothetical proposal</option><option value="synthetic">Fictional demonstration</option></select></label>
      <p>Originals are already retained. Choose a block and declare origin only to start spatial extraction. Its retained metre frame is reused; image controls still need evidence and review.</p>
    </fieldset>}
    {!buildingId && !target && contextOnly && <Button variant="primary" disabled={mutation.busy || !area || !origin} onClick={()=>void mutation.run(async()=>{const pkg=await destination();if(pkg?.sourceWorkspace)router.push(withQuery(routes.case(pkg.sourceWorkspace.caseId),{mode:"build"}));})}>Continue to extraction</Button>}
    {unsupported && <p role="alert">{invalidDocument || "Remove unsupported files to continue. Their originals have not been uploaded."}</p>}
    {files.filter(row=>row.kind==="dataset").map(row=><DatasetIntake key={row.id} file={row.file}/>)}
    {gis && !unsupported && (!buildingId || !!dossier.data) && !areas.loading && <section className="source-intake-gis" aria-label={`Review ${gis.file.name}`}><h2>Review GIS details</h2><ImportForm key={`${gis.id}:${area?.id || "new"}`} area={area} busy={mutation.busy} initialFile={gis.file} hideFileControls onImport={operation=>{void mutation.run(async()=>{const pkg=await operation();setFiles(old=>old.map(row=>row.id===gis.id?{...row,state:"retained",package:pkg || undefined}:row));if(!areaId){setAreaId(pkg.areaId);const context=await request<AreaContext>(`/areas/${pkg.areaId}/context`);setCreatedArea(context.area);}await areas.reload();});}}/></section>}
    {review && <section className="source-intake-gis"><Button variant="ghost" onClick={()=>setReview(null)}>Close GIS review</Button><ImportReview pkg={review} busy={mutation.busy} onUpdate={operation=>{void mutation.run(async()=>setReview(await operation()));}} onCommitted={pkg=>{setReview(pkg);}}/></section>}
    {documents.length>0 && <footer className="source-intake-footer"><p>Original files are retained unchanged. Receipt is separate from suitability and recording.</p><Button variant="primary" disabled={!ready} onClick={()=>void retainDocuments()}>Continue to document review</Button>{!ready && !mutation.busy && <small>{unsupported ? invalidDocument || "Remove unsupported files to continue." : "Waiting for the selected destination to load."}</small>}</footer>}
    {retained.some(f=>f.kind==="document") && <div className="source-intake-footer"><p>{retained.filter(f=>f.kind==="document").length} document(s) retained. You can leave and resume the saved workspace.</p><Button variant="primary" onClick={()=>router.push(buildingId?routes.workspace(buildingId,area?.id):withQuery(routes.case(workspace.current?.sourceWorkspace?.caseId || sourceCase.current!), {mode:"build",area:area?.id}))}>Open source review</Button></div>}
    {mutation.busy && <p role="status">Reading and retaining originals…</p>}
  </main>;
}
