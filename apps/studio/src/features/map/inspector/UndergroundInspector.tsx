import { DownloadSimple } from '@phosphor-icons/react';
import { Button, DigColumn } from '@ulpin/ui';

/** Underground screening. With no utility survey the only band is Unknown: never drawn as clear. */
export function UndergroundInspector() {
  return (
    <DigColumn
      range="No survey"
      bands={[{ id: 'none', depth: 'All depths', unknown: true, label: <><strong>Unknown</strong> · no utility survey for this area</> }]}
      actions={(
        <>
          <Button variant="primary" icon={DownloadSimple} disabled title="Nothing to report until a survey is linked">Export screening report</Button>
          <span className="ul-help">Blocked: no utility survey is linked to this area.</span>
        </>
      )}
    />
  );
}
