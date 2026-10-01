import type { PoolClient } from 'pg';
import type { SnapshotManifest, DeclarationInput, DeclarationAssessment, ReviewDeclaration } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';

export type DeclarationBody = {
  pin: { ref: { namespace: string; id: string }; revision: number };
  input: DeclarationInput; assessment: DeclarationAssessment;
  supersedes: DeclarationBody['pin'] | null; review: ReviewDeclaration;
  technicalStatus: 'technically_accepted'; legalStatus: 'not_assessed';
};
export async function declarationSnapshotRowsTx(client: PoolClient, siteId: string) {
  const declarations = (await client.query(`SELECT DISTINCT ON(id) id,revision,body FROM usp_declaration_revisions
    WHERE site_id=$1 ORDER BY id,revision DESC LIMIT 11`, [siteId])).rows;
  if (declarations.length > 10) throw new AppError(413, 'DECLARATION_SITE_LIMIT', 'This profile supports ten declarations per site.');
  const rows: { namespace: string; object_id: string; revision: number; body: Record<string, any> }[] = [];
  for (const d of declarations) {
    rows.push({ namespace: 'declaration', object_id: d.id, revision: Number(d.revision), body: d.body });
    for (const [table, namespace] of [['usp_declaration_entries', 'declaration_entry'], ['usp_declaration_applicability', 'applicability']] as const) {
      const children = (await client.query(`SELECT id,revision,body FROM ${table}
        WHERE declaration_id=$1 AND declaration_revision=$2 ORDER BY id LIMIT 101`, [d.id, d.revision])).rows;
      if (children.length > 100) throw new AppError(413, 'DECLARATION_MEMBER_LIMIT', 'The declaration exceeds this profile.');
      rows.push(...children.map(e => ({ namespace, object_id: e.id, revision: Number(e.revision), body: e.body })));
    }
  }
  return rows;
}
export function declarationMembership(members: SnapshotManifest['members']) {
  const pins = (namespace: string) => members.filter(m => m.pin.ref.namespace === namespace).map(m => m.pin);
  const declarationRevisions = pins('declaration');
  return { state: declarationRevisions.length ? 'available' as const : 'not_assessed' as const,
    declarationRevisions, entryRevisions: pins('declaration_entry'), applicabilityRevisions: pins('applicability') };
}
/** General snapshot reads must never expose sibling labels, clauses, consent or reviewer reasons. */
export function declarationSnapshotView(namespace: string, body: Record<string, any>): Record<string, any> {
  if (namespace === 'declaration') return { pin: body.pin, technicalStatus: body.technicalStatus,
    legalStatus: 'not_assessed', assessment: body.assessment };
  return { pin: body.pin, declaration: body.declaration, state: 'selected_target_read_required' };
}
