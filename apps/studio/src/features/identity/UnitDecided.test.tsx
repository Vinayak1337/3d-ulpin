import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecordedUnit } from '../review/recorded/model';
import { UnitDecided } from './UnitDecided';

// Shape-only unit and gap: placeholders for the component under test, not a record.
const unit = { id: 'unit-id', label: 'unit label', citations: [], code: null } as unknown as RecordedUnit;

describe('UnitDecided', () => {
  it('shows the stated gaps of the building under the unit', () => {
    const markup = renderToStaticMarkup(
      <UnitDecided unit={unit} floorLabel="floor label" subject="the revision" gaps={['stated gap']} />,
    );
    expect(markup).toContain('stated gap');
  });
});
