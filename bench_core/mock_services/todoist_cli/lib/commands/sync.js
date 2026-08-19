// `todoist sync` (alias: s) — sync cache
// Source: sync.go. The real command calls client.Sync(ctx) then WriteCache and
// returns nil — it prints NOTHING on success (output only ever comes from the
// top-level "Error: <err>" path). The mock has no remote API, so it is a no-op
// that likewise produces no output.
export function cmdSync() {
  return { ok: true };
}
