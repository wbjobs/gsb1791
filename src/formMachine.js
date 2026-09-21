/**
 * Form machine factory: builds a serializable FSM from a declarative
 * multi-step form definition with branching, merging and back navigation.
 *
 * Definition shape:
 * {
 *   id, initial,
 *   steps: {
 *     stepName: {
 *       fields: string[],                 // rendered/owned by this step
 *       next: [ { target, when?(data) } ] // first matching guard wins (branching)
 *            | string,                    // unconditional
 *     },
 *     done: { final: true },
 *   }
 * }
 *
 * Branching & merging: `next` arrays create branches; different branches may
 * point at the same target (merge). formData lives in ONE flat context map,
 * so switching branch never discards previously entered data.
 */
import { createMachine } from './machine.js';

export function createFormMachine(definition) {
  const states = {};
  for (const [name, step] of Object.entries(definition.steps)) {
    if (step.final) {
      states[name] = { final: true };
      continue;
    }
    const nextList = typeof step.next === 'string' ? [{ target: step.next }] : step.next ?? [];
    states[name] = {
      meta: { fields: step.fields ?? [] },
      on: {
        // Field edit: merges into the single flat formData map.
        CHANGE: {
          assign: (ctx, e) => ({ formData: { ...ctx.formData, [e.field]: e.value } }),
          effects: (ctx, e) => ({ type: 'fieldChanged', field: e.field }),
        },
        // Branching transition: guards evaluated in order.
        NEXT: nextList.map((t) => ({
          target: t.target,
          guard: t.when ? (ctx) => !!t.when(ctx.formData) : undefined,
          effects: () => ({ type: 'stepEntered', step: t.target }),
        })),
        BACK: { effects: [] }, // handled by controller via machine.back()
      },
    };
  }

  const machine = createMachine({
    id: definition.id ?? 'form',
    initial: definition.initial,
    context: { formData: {} },
    states,
  });

  return {
    ...machine,
    definition,
    fieldsOf: (value) => definition.steps[value]?.fields ?? [],
    /** All fields owned by steps reachable on the current visited path. */
    isFinal: machine.isFinal,
  };
}
