import type { PoolClient } from 'pg';

/** The sequence and event are committed or rolled back with the caller's mutation. */
export async function appendUspOutboxTx(client: PoolClient, streamId: string, body: object) {
  await client.query('INSERT INTO usp_outbox_streams(stream_id) VALUES($1) ON CONFLICT DO NOTHING', [streamId]);
  const row = (await client.query(
    'UPDATE usp_outbox_streams SET last_sequence=last_sequence+1 WHERE stream_id=$1 RETURNING last_sequence::text AS sequence',
    [streamId],
  )).rows[0];
  const sequence = String(row.sequence);
  await client.query('INSERT INTO usp_outbox(stream_id,sequence,body) VALUES($1,$2,$3)', [streamId, sequence, body]);
  return { streamId, sequence };
}
