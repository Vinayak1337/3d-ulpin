"use client";
import { useState } from "react";
import type { RegistryRecord } from "@ulpin/contracts";
import { Badge, Icon } from "../shared/ui";
import { number } from "./model";
import styles from "./register.module.css";

/** Compact record index beside the shared scene. Every action uses a canonical record ID. */
export default function FloorIndex({
  floors,
  spaces,
  onRecord,
}: {
  floors: RegistryRecord[];
  spaces: RegistryRecord[];
  onRecord: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(
    floors[0]?.id || null,
  );
  return (
    <section className={styles.floorIndex} aria-label="Floor and space index">
      <h3>
        Floors & spaces <Badge>{spaces.length}</Badge>
      </h3>
      <div className={styles.floorColumns}>
        <span>Level / space</span>
        <span>Area</span>
      </div>
      {floors.length ? (
        floors.map((floor) => {
          const units = spaces.filter((r) =>
            r.links.some((l) => l.type === "floor" && l.targetId === floor.id),
          );
          const name = floor.name.replace(/^property\s*\/\s*/i, "");
          const open = expanded === floor.id;
          return (
            <div className={styles.floorGroup} key={floor.id}>
              <div className={styles.floorHeading}>
                <button onClick={() => onRecord(floor.id)}>
                  <Icon name="layers" />
                  <span>
                    <strong>{name}</strong>
                    <small>{units.length} spaces</small>
                  </span>
                </button>
                <button
                  aria-label={`${open ? "Collapse" : "Expand"} ${name} spaces`}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : floor.id)}
                >
                  <Icon name={open ? "down" : "chevron"} />
                </button>
              </div>
              {open &&
                units.map((unit) => (
                  <button
                    className={styles.spaceIndexRow}
                    key={unit.id}
                    onClick={() => onRecord(unit.id)}
                  >
                    <Icon name="home" />
                    <span>
                      <strong>{unit.name}</strong>
                      <small>{unit.identifier.split(":").at(-1)}</small>
                    </span>
                    <span>{number(unit.geometry?.area, "m²")}</span>
                  </button>
                ))}
            </div>
          );
        })
      ) : (
        <p className={styles.referenceNote}>
          Detailed floor plans have not been supplied.
        </p>
      )}
    </section>
  );
}
