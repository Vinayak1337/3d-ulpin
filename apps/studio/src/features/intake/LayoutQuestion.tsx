import { useState } from 'react';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { GetResponse } from '@ulpin/api-client';
import { useTableProfile } from './table/queries';
import { fieldWords } from './batch-model';
import styles from './Batch.module.css';

type Profile = GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile'>;
type MapProfile = Extract<Profile, { version: 'manual-geojson/1' }>;

/** The published profile lacks destination suggestions, so this question cannot author a layout yet. */
export function LayoutQuestion({ caseId, sourceId, name }: { caseId: string; sourceId: string; name: string }) {
  const profile = useTableProfile(caseId, sourceId);
  return <section className={styles.question} aria-label={`Layout question for ${name}`}>
    <h2 className="ul-heading">Available layout fields · {name}</h2>
    {profile.isPending ? <Skeleton /> : null}
    {profile.error ? <Banner tone="danger">{profile.error.message}</Banner> : null}
    {profile.data?.version === 'manual-geojson/1' ? <>
      <LayoutFields profile={profile.data} />
      <Banner tone="warning">
        The profile does not supply an area name or naming scope. A layout cannot be proposed here yet.
        The batch also does not supply its current layout, so it cannot be reviewed or approved here.
      </Banner>
      <Button variant="primary" disabled title="The profile and batch do not supply the required layout details.">
        Propose layout
      </Button>
    </> : null}
    {profile.data && profile.data.version !== 'manual-geojson/1' ?
      <p>This question is only available for retained map files.</p> : null}
  </section>;
}

function LayoutFields({ profile }: { profile: MapProfile }) {
  const [identifier, setIdentifier] = useState('');
  return <div className={styles.fields}>
    <label className="ul-field">
      <span className="ul-label">Field identifying each feature</span>
      <select className="ul-input" value={identifier} onChange={(event) => setIdentifier(event.target.value)}>
        <option value="">Choose a field</option>
        {profile.paths.filter((field) => field.literalIdEligible).map((field) => (
          <option key={field.path} value={field.path}>{fieldWords(field.path)}</option>
        ))}
      </select>
      <span className="ul-help">No suggested identifier is supplied by this profile.</span>
    </label>
    <div className="ul-field">
      <span className="ul-label">Feature kind</span>
      <span>Buildings</span>
      <span className="ul-help">This retained-file layout supports buildings only.</span>
    </div>
    <div className="ul-field">
      <span className="ul-label">Area name</span>
      <span>Not known</span>
    </div>
  </div>;
}
