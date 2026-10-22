import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TableStepNotice } from './TablePage';

it('names the table-only step and points to Place on the map in the batch, never denying a card', () => {
  const html = renderToStaticMarkup(<TableStepNotice />);
  expect(html).toContain('This page is the table-only step');
  expect(html).toContain('by itself puts nothing in the registry or on the map');
  expect(html).toContain('use Place on the map on this table&#x27;s line in a batch');
  expect(html).toContain('to a property card that an officer confirms');
  // The old words spoke for every table, as if no table's rows could reach the map.
  expect(html).not.toContain('Tables produce mapped draft rows');
  expect(html).not.toContain('Nothing enters the registry or the map');
});
