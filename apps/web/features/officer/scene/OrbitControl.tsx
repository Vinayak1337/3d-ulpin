"use client";
import type { AreaNavigation } from "@/components/AreaViewer";
import { Icon } from "../shared/ui";
export default function OrbitControl({
  onNavigate,
}: {
  onNavigate: (action: AreaNavigation["action"]) => void;
}) {
  return (
    <div className="scene-orbit-control">
      <div className="scene-orbit-pad" role="group" aria-label="Rotate 3D view">
        <button
          className="orbit-up"
          aria-label="Rotate view up"
          title="Rotate up"
          onClick={() => onNavigate("orbit_up")}
        >
          ↑
        </button>
        <button
          className="orbit-left"
          aria-label="Rotate view left"
          title="Rotate left"
          onClick={() => onNavigate("orbit_left")}
        >
          ←
        </button>
        <button
          className="orbit-reset"
          aria-label="Reset building view"
          title="Reset building view"
          onClick={() => onNavigate("focus")}
        >
          <Icon name="target" size={15} />
        </button>
        <button
          className="orbit-right"
          aria-label="Rotate view right"
          title="Rotate right"
          onClick={() => onNavigate("orbit_right")}
        >
          →
        </button>
        <button
          className="orbit-down"
          aria-label="Rotate view down"
          title="Rotate down"
          onClick={() => onNavigate("orbit_down")}
        >
          ↓
        </button>
      </div>
      <span>Ctrl + drag to rotate</span>
    </div>
  );
}
