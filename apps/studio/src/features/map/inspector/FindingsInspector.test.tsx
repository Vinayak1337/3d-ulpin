import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import lakeRegister from '../../../local/data/lake-view/register.json';
import type { BuildingRegister } from '../../../api/queries';
import { FindingsInspector } from './FindingsInspector';

// The local Lake View register: its overlap finding states one limitation in the record.
const register = lakeRegister as unknown as BuildingRegister;

it('a finding lists the limitations its record states', () => {
  const finding = register.findings.find((f) => f.limitations?.length)!;
  const markup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <FindingsInspector register={register} ledger={null} findingId={finding.id} buildingId={register.property.id}
      crumbs={[]} onOpenSpace={() => undefined} />
  </MemoryRouter></QueryClientProvider>);
  expect(markup).toContain(finding.message);
  for (const limitation of finding.limitations!) expect(markup).toContain(`<li>${limitation}</li>`);
});
