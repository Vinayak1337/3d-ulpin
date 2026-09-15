"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CaseRecord } from "@ulpin/contracts";
import { request, useMutation, useResource } from "../shared/hooks";
import { routes, withQuery } from "../shared/routes";
import { useOfficerStore } from "../shared/store";
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
import PropertyChooser from "./PropertyChooser";
import styles from "./Workspace.module.css";
export default function WorkspaceStart() {
  const router = useRouter(),
    recent = useOfficerStore((s) => s.recentProperties);
  const cases = useResource<
    (CaseRecord & {
      buildingId?: string;
      areaId?: string;
      propertyName?: string;
      sourceCount: number;
    })[]
  >("/workspace-directory");
  const mutation = useMutation();
  const [create, setCreate] = useState(false),
    [choose, setChoose] = useState(false);
  const drafts = cases.data || [];
  return (
    <div className={styles.start}>
      <header className={styles.startHeading}>
        <div>
          <p className={styles.eyebrow}>PLAN WORKSPACE</p>
          <h1>Plan Workspace</h1>
          <p>Create a workspace or continue a saved plan.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreate(true)}>
          New workspace
        </Button>
      </header>
      <div className={styles.startActions}>
        <button onClick={() => setCreate(true)}>
          <span>
            <Icon name="upload" size={26} />
          </span>
          <h2>Start with a plan</h2>
          <p>Upload documents and assign a property when ready.</p>
          <b>
            Upload a source <Icon name="arrow" />
          </b>
        </button>
        <button onClick={() => setChoose(true)}>
          <span>
            <Icon name="building" size={26} />
          </span>
          <h2>Open a property</h2>
          <p>Choose a building and open its linked plans.</p>
          <b>
            Choose property <Icon name="arrow" />
          </b>
        </button>
      </div>
      {!!recent.length && (
        <Panel title="Recently opened properties">
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
        </Panel>
      )}
      <Panel
        title="Saved workspaces"
        actions={<Badge>{drafts.length} saved</Badge>}
      >
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
                    {(c.propertyName || c.name).replace(/v2/gi, "")}
                  </strong>
                  <small>
                    Updated {new Date(c.updatedAt).toLocaleDateString()}
                  </small>
                </span>
                <Badge>
                  {c.buildingId ? `${c.sourceCount} sources` : "Unassigned"}
                </Badge>
                <Icon name="arrow" />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Room for your next plan"
            description="Your saved drafts will appear here."
            icon="workspace"
          />
        )}
      </Panel>
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
              const item = await request<CaseRecord>("/cases", {
                name,
                description:
                  "Unassigned plan workspace. Originals retained; no property assigned.",
              });
              router.push(routes.case(item.id));
            });
          }}
        >
          <label>
            Workspace name
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Use the source or project name"
            />
          </label>
          <p className={styles.muted}>
            Next, add PDF, PNG or level CSV originals. This draft does not
            create a property record.
          </p>
          {mutation.error && <ErrorState message={mutation.error} />}
          <Button type="submit" variant="primary" disabled={mutation.busy}>
            Create workspace
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
