// Shared by the daily scheduled snapshot (backups-scheduled.mjs) and the
// admin-facing Backups tab (backups.mjs) — kept in one place so both agree
// on the key format and retention.
export const PREFIX = 'backups/';
const KEEP = 30; // days

export async function snapshot(s, reason = 'manual') {
  const content = (await s.get('content', { type: 'json' })) || {};
  const at = new Date().toISOString();
  const key = `${PREFIX}${at.slice(0, 10)}T${at.slice(11, 19).replace(/:/g, '-')}`;
  await s.setJSON(key, { at, reason, content });

  // Keep only the newest KEEP snapshots.
  const { blobs } = await s.list({ prefix: PREFIX });
  const extra = blobs.map((b) => b.key).sort().reverse().slice(KEEP);
  await Promise.all(extra.map((k) => s.delete(k)));
  return key;
}
