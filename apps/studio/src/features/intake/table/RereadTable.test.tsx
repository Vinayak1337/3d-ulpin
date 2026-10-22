import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { createEncodingReread, EncodingRereadForm } from './RereadTable';
import { officerEncodingSelection } from './retain';
import type { TableProfile } from './types';

const state = vi.hoisted(() => ({ revision: 4 }));
vi.mock('@ulpin/api-client', () => ({
  api: { GET: vi.fn(async () => ({ case: { revision: state.revision, archived: false } })) },
  unwrap: (value: unknown) => value,
}));

const profile = { caseId: 'case', source: { sourceId: 'source' }, tabular: { selection: {
  format: 'csv', sheet: 'csv', table: null, headerRows: [1], delimiter: ';', encoding: 'windows-1252',
  encodingBasis: 'fallback_windows_1252',
} } } as unknown as TableProfile;

it('offers only the fixed supported encodings with BOM and unchanged-byte words', () => {
  const html = renderToStaticMarkup(<EncodingRereadForm encoding="" setEncoding={vi.fn()} pending={false}
    submit={vi.fn()} error={null} reading={null} />);
  for (const encoding of ['UTF-8', 'Windows-1252', 'ISO-8859-1', 'UTF-16 LE', 'UTF-16 BE']) {
    expect(html).toContain(encoding);
  }
  expect(html).toContain('Officer-stated encoding');
  expect(html).toContain('matching BOM');
  expect(html).toContain('not supported or inferred');
  expect(html).toContain('The original stays unchanged.');
  expect(html).toContain('original byte ranges');
  expect(html).not.toContain('value="ISCII"');
  expect(html).toContain('disabled=""');
});

it('pins a supported officer choice and refuses an unsupported encoding with words', () => {
  expect(officerEncodingSelection(profile.tabular.selection, 'iso-8859-1')).toEqual({
    ...profile.tabular.selection, encoding: 'iso-8859-1', encodingBasis: 'officer_stated',
  });
  expect(() => officerEncodingSelection(profile.tabular.selection, 'ISCII')).toThrow('Unsupported table encoding');
});

it('re-reads the same original through the existing table path and retries a lost response with the same key',
  async () => {
    const follow = vi.fn().mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValue({ caseId: 'case', sourceId: 'source' });
    const send = createEncodingReread(profile, follow);
    await expect(send('iso-8859-1')).rejects.toThrow('Lost response');
    await send('iso-8859-1');
    expect(follow.mock.calls[1]![2]).toEqual(follow.mock.calls[0]![2]);
    expect(follow.mock.calls[1]!.slice(0, 2)).toEqual(['case', 'source']);
    expect(follow.mock.calls[1]![2]).toMatchObject({ expectedWorkspaceRevision: 4, selection: {
      ...profile.tabular.selection, encoding: 'iso-8859-1', encodingBasis: 'officer_stated',
    } });
    await send('utf-8');
    expect(follow.mock.calls[2]![2].requestKey).not.toEqual(follow.mock.calls[1]![2].requestKey);
  });
