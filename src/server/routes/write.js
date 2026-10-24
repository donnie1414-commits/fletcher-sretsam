/** POST ?route=write  body { changes: [{ changeId, recordType, recordId, version, fields }] } → per-row results (§3.9). */
export function routeWrite(ctx, body) {
  const changes = Array.isArray(body && body.changes) ? body.changes.slice(0, 200) : [];
  if (!changes.length) return { results: [], deferred: [], error: 'no changes' };
  return ctx.writes.apply(changes, ctx.scope);
}
