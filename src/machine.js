/**
 * XState-style finite state machine, self-contained, zero dependencies.
 *
 * Design constraints:
 *  - State is ALWAYS a plain JSON-serializable object: { value, context, history }.
 *  - Guards/reducers are functions in the config (not serialized); only data travels.
 *  - `transition` is pure: (state, event) => { state, effects }.
 *    Side effects (async validation, persistence) are executed by an interpreter,
 *    which keeps the machine deterministic, testable and serializable.
 */

export function createMachine(config) {
  if (!config || !config.states || !config.initial) {
    throw new Error('machine config requires `initial` and `states`');
  }
  return {
    id: config.id ?? 'machine',
    config,

    /** Initial serializable state. */
    initialState() {
      return {
        value: config.initial,
        context: structuredClone(config.context ?? {}),
        // history: stack of previously visited state values (for BACK).
        history: [],
      };
    },

    /**
     * Pure transition. Returns { state, effects, changed }.
     * Unknown events / failing guards => changed:false, same state object.
     */
    transition(state, event) {
      const node = config.states[state.value];
      if (!node) throw new Error(`unknown state: ${state.value}`);
      const handlers = node.on?.[event.type];
      if (!handlers) return { state, effects: [], changed: false };

      const list = Array.isArray(handlers) ? handlers : [handlers];
      for (const t of list) {
        const transition = typeof t === 'string' ? { target: t } : t;
        if (transition.guard && !transition.guard(state.context, event)) continue;

        let context = state.context;
        if (transition.assign) {
          context = { ...context, ...transition.assign(state.context, event) };
        }

        let value = state.value;
        let history = state.history;
        if (transition.target && transition.target !== state.value) {
          value = transition.target;
          history = transition.internal
            ? state.history
            : [...state.history, state.value];
        }

        const effects = [];
        if (transition.effects) {
          const fxList = typeof transition.effects === 'function'
            ? [transition.effects]
            : transition.effects;
          for (const fx of fxList) {
            effects.push(typeof fx === 'function' ? fx(context, event) : fx);
          }
        }
        if (transition.target && transition.target !== state.value) {
          const entered = config.states[transition.target];
          if (entered?.entry) {
            for (const fx of [].concat(entered.entry)) {
              effects.push(typeof fx === 'function' ? fx(context, event) : fx);
            }
          }
        }

        return {
          state: { value, context, history },
          effects: effects.filter(Boolean),
          changed: true,
        };
      }
      return { state, effects: [], changed: false };
    },

    /**
     * BACK navigation: pop the history stack. Pure.
     * Returns null when there is nowhere to go back to.
     */
    back(state) {
      if (!state.history.length) return null;
      const history = [...state.history];
      const value = history.pop();
      return { ...state, value, history };
    },

    /** Rehydrate a persisted snapshot, validating it against the config. */
    resolveState(snapshot) {
      if (!snapshot || typeof snapshot.value !== 'string') {
        throw new Error('invalid snapshot');
      }
      if (!config.states[snapshot.value]) {
        throw new Error(`snapshot points at unknown state: ${snapshot.value}`);
      }
      return {
        value: snapshot.value,
        context: structuredClone(snapshot.context ?? {}),
        history: Array.isArray(snapshot.history) ? [...snapshot.history] : [],
      };
    },

    /** True when the state value is a final node. */
    isFinal(state) {
      return config.states[state.value]?.final === true;
    },
  };
}
