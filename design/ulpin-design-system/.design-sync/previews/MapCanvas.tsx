import { EVIDENCE_AND_RECORD_KEYS, Legend, LevelRail, MapCanvas, MapPatterns, MapToolbar } from '@ulpin/design-system';

export const WithChrome = () => (
  <div style={{ width: 720 }}>
    <MapCanvas
      height={420}
      overlays={
        <>
          <div style={{ position: 'absolute', top: 16, left: 16 }}>
            <MapToolbar />
          </div>
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <LevelRail
              reference="m · SD-1"
              ground="212.4"
              defaultSelected="F7"
              levels={[
                { id: 'Roof', elevation: '239.8' },
                { id: 'F8', elevation: '236.8', ghost: true },
                { id: 'F7', elevation: '233.8' },
                { id: 'G', elevation: '212.8' },
                { id: 'B1', elevation: '209.1', belowGround: true },
              ]}
            />
          </div>
          <div style={{ position: 'absolute', bottom: 16, left: 16 }}>
            <Legend sections={EVIDENCE_AND_RECORD_KEYS.slice(1)} />
          </div>
          <div className="data-num" style={{ position: 'absolute', bottom: 16, right: 16, color: 'var(--ink-soft)' }}>
            EPSG:32643 · 212.40 m · SD-1
          </div>
        </>
      }
    >
      <svg viewBox="0 0 720 420" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <MapPatterns />
        <rect className="m-ground" width="720" height="420" />
        <rect className="m-road" x="0" y="330" width="720" height="48" />
        <g className="m-ctx">
          <rect className="m-bldg" x="120" y="120" width="120" height="150" />
          <rect className="m-bldg" x="540" y="110" width="120" height="120" />
        </g>
        <rect className="m-parcel" x="280" y="90" width="220" height="220" />
        <rect className="m-halo" x="310" y="120" width="160" height="170" />
        <rect className="m-sel" x="310" y="120" width="160" height="170" />
        <text className="m-label" x="310" y="110">Lake View Residence</text>
        <text className="m-code" x="290" y="304">MH2507A1B3C4D5</text>
      </svg>
    </MapCanvas>
  </div>
);
