/**
 * FormController — the interpreter that wires everything together:
 *   form machine (pure) + validation coordinator (token-guarded async)
 *   + draft persistence (IndexedDB) + share codec.
 *
 * All mutable runtime state lives here; the machine state itself stays
 * JSON-serializable at all times (acceptance: serializable / resumable).
 */
import { createValidationCoordinator, validationReducer } from './validation.js';
import { encodeShareToken, decodeShareToken } from './share.js';

const SNAPSHOT_VERSION = 1;

export function createFormController({
  machine,
  validators = {},
  runValidation,          // (field, value, data) => error|null|Promise — worker client or inline
  draftStore = null,      // from createDraftStore(); null disables persistence
  draftId = 'default',
  autosave = true,
}) {
  const coordinator = createValidationCoordinator(validators, runValidation);

  let state = machine.initialState();
  let validation = {}; // field -> { status: 'idle'|'pending'|'valid'|'invalid'|'stale', error }
  const listeners = new Set();
  let saveTimer = null;

  const emit = () => listeners.forEach((fn) => fn(getSnapshot()));

  function scheduleSave() {
    if (!draftStore || !autosave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      draftStore.save(draftId, serialize()).catch(() => {});
    }, 150);
  }

  function validateField(field) {
    const spec = validators[field];
    if (!spec) return;
    validation = validationReducer(validation, { type: 'pending', field });
    const { promise } = coordinator.validate(field, state.context.formData[field], state.context.formData);
    emit();
    promise.then((result) => {
      // Race guard: coordinator marks superseded runs with applied:false.
      if (!result.applied) return;
      validation = validationReducer(validation, { type: 'resolved', field, error: result.error });
      emit();
      scheduleSave();
    });
  }

  function invalidateDependents(field) {
    for (const dep of coordinator.affectedBy(field)) {
      validation = validationReducer(validation, { type: 'stale', field: dep });
      validateField(dep); // re-run async validation for dependents
    }
  }

  function applyEffects(effects) {
    for (const fx of effects) {
      if (fx?.type === 'fieldChanged') {
        validateField(fx.field);
        invalidateDependents(fx.field);
      }
    }
  }

  function send(event) {
    const result = machine.transition(state, event);
    if (!result.changed) return false;
    state = result.state;
    applyEffects(result.effects);
    emit();
    scheduleSave();
    return true;
  }

  function getSnapshot() {
    return {
      state,
      value: state.value,
      data: state.context.formData,
      validation,
      canGoBack: state.history.length > 0,
      isFinal: machine.isFinal(state),
    };
  }

  /** JSON-serializable snapshot — the ONLY thing needed to resume anywhere. */
  function serialize() {
    return structuredClone({
      v: SNAPSHOT_VERSION,
      machine: machine.id,
      state,
      validation,
    });
  }

  /** Restore from a serialized snapshot (refresh / shared draft / new device). */
  function restore(snapshot) {
    if (!snapshot || snapshot.v !== SNAPSHOT_VERSION) throw new Error('unsupported snapshot version');
    state = machine.resolveState(snapshot.state);
    validation = structuredClone(snapshot.validation ?? {});
    // Anything that was mid-flight when persisted is stale now: revalidate.
    for (const [field, meta] of Object.entries(validation)) {
      if (meta.status === 'pending') validateField(field);
    }
    emit();
  }

  async function restoreFromDraft(id = draftId) {
    if (!draftStore) return false;
    const snap = await draftStore.load(id);
    if (!snap) return false;
    restore(snap);
    return true;
  }

  return {
    send,
    getSnapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    change(field, value) { return send({ type: 'CHANGE', field, value }); },
    next() { return send({ type: 'NEXT' }); },
    back() {
      const prev = machine.back(state);
      if (!prev) return false;
      state = prev;
      emit();
      scheduleSave();
      return true;
    },

    serialize,
    restore,
    restoreFromDraft,
    shareToken: () => encodeShareToken(serialize()),
    restoreFromShareToken(token) { restore(decodeShareToken(token)); },
    clearDraft: () => draftStore?.remove(draftId),
  };
}
