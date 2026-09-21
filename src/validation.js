/**
 * Dependency-aware validation coordinator.
 *
 * - validators: { field: { deps?: string[], validate(value, data) => string|null|Promise<string|null> } }
 *   A validator returns an error message string, or null when valid.
 * - Dependency graph: when field X changes, every field that (transitively)
 *   depends on X is marked `stale` and re-validated.
 * - Race-free async: every validation run carries a monotonically increasing
 *   token per field. A result is applied only if its token is still the latest
 *   for that field — late/arbitrary-order resolutions are discarded.
 */

export function createValidationCoordinator(validators, runField) {
  // dependents: field -> Set of fields that depend on it (transitive closure).
  const dependents = {};
  const memo = {};
  const visit = (field, seen = new Set()) => {
    if (memo[field]) return memo[field];
    const out = new Set();
    for (const [name, v] of Object.entries(validators)) {
      if ((v.deps ?? []).includes(field) && !seen.has(name)) {
        out.add(name);
        seen.add(name);
        for (const d of visit(name, seen)) out.add(d);
      }
    }
    memo[field] = out;
    return out;
  };
  for (const name of Object.keys(validators)) dependents[name] = visit(name);

  const tokens = new Map(); // field -> latest token (number)
  let seq = 0;

  const nextToken = (field) => {
    const t = ++seq;
    tokens.set(field, t);
    return t;
  };
  const isCurrent = (field, token) => tokens.get(field) === token;

  return {
    dependents,
    /** Fields that must be re-validated when `field` changes. */
    affectedBy: (field) => [...(dependents[field] ?? [])],
    nextToken,
    isCurrent,
    /**
     * Run one field's validator through the injected runner (`runField`),
     * which is where the Web Worker / inline execution lives.
     * Returns { token, promise } — promise resolves to
     * { field, token, error, applied } where `applied:false` means a newer
     * run superseded this one (stale result dropped => no race).
     */
    validate(field, value, data) {
      const token = nextToken(field);
      let result;
      try {
        result = runField(field, value, data); // starts synchronously
      } catch (err) {
        result = Promise.reject(err);
      }
      const promise = Promise.resolve(result)
        .then(
          (error) => ({ field, token, error: error ?? null, applied: isCurrent(field, token) }),
          (err) => ({ field, token, error: String(err?.message ?? err), applied: isCurrent(field, token) }),
        );
      return { token, promise };
    },
  };
}

/** Topological invalidation statuses reducer, pure & serializable-friendly. */
export function validationReducer(statuses, action) {
  const next = { ...statuses };
  switch (action.type) {
    case 'pending':
      next[action.field] = { status: 'pending', error: null };
      return next;
    case 'resolved':
      next[action.field] = { status: action.error ? 'invalid' : 'valid', error: action.error ?? null };
      return next;
    case 'stale':
      if (next[action.field]) next[action.field] = { ...next[action.field], status: 'stale' };
      return next;
    default:
      return statuses;
  }
}
