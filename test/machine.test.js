import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignupMachine } from '../src/signupForm.js';

test('machine state is JSON-serializable at every step', () => {
  const m = createSignupMachine();
  let state = m.initialState();
  const events = [
    { type: 'CHANGE', field: 'username', value: 'alice' },
    { type: 'CHANGE', field: 'type', value: 'company' },
    { type: 'NEXT' },
    { type: 'CHANGE', field: 'companyName', value: 'Acme' },
    { type: 'NEXT' },
  ];
  for (const e of events) {
    state = m.transition(state, e).state;
    // Round-trip through JSON must not lose anything.
    state = m.resolveState(JSON.parse(JSON.stringify(state)));
  }
  assert.equal(state.value, 'review');
  assert.deepEqual(state.context.formData, { username: 'alice', type: 'company', companyName: 'Acme' });
});

test('branching: guard picks company vs personal', () => {
  const m = createSignupMachine();
  let s = m.initialState();
  s = m.transition(s, { type: 'CHANGE', field: 'type', value: 'company' }).state;
  assert.equal(m.transition(s, { type: 'NEXT' }).state.value, 'company');

  let p = m.initialState();
  p = m.transition(p, { type: 'CHANGE', field: 'type', value: 'personal' }).state;
  assert.equal(m.transition(p, { type: 'NEXT' }).state.value, 'personal');
});

test('branch merge: both branches converge on review then done', () => {
  const m = createSignupMachine();
  for (const branch of ['company', 'personal']) {
    let s = m.initialState();
    s = m.transition(s, { type: 'CHANGE', field: 'type', value: branch }).state;
    s = m.transition(s, { type: 'NEXT' }).state;
    assert.equal(s.value, branch);
    s = m.transition(s, { type: 'NEXT' }).state;
    assert.equal(s.value, 'review');
    s = m.transition(s, { type: 'NEXT' }).state;
    assert.equal(s.value, 'done');
    assert.ok(m.isFinal(s));
  }
});

test('branch switch does not lose the other branch’s data', () => {
  const m = createSignupMachine();
  let s = m.initialState();
  s = m.transition(s, { type: 'CHANGE', field: 'type', value: 'company' }).state;
  s = m.transition(s, { type: 'NEXT' }).state;
  s = m.transition(s, { type: 'CHANGE', field: 'companyName', value: 'Acme' }).state;
  // Go back and switch branch.
  s = m.back(s);
  s = m.transition(s, { type: 'CHANGE', field: 'type', value: 'personal' }).state;
  s = m.transition(s, { type: 'NEXT' }).state;
  assert.equal(s.value, 'personal');
  // companyName survives the branch switch.
  assert.equal(s.context.formData.companyName, 'Acme');
});

test('back navigation pops the history stack', () => {
  const m = createSignupMachine();
  let s = m.initialState();
  assert.equal(m.back(s), null); // nowhere to go
  s = m.transition(s, { type: 'NEXT' }).state; // -> personal
  s = m.transition(s, { type: 'NEXT' }).state; // -> review
  assert.deepEqual(s.history, ['account', 'personal']);
  s = m.back(s);
  assert.equal(s.value, 'personal');
  s = m.back(s);
  assert.equal(s.value, 'account');
  assert.equal(m.back(s), null);
});

test('resolveState rejects snapshots pointing at unknown states', () => {
  const m = createSignupMachine();
  assert.throws(() => m.resolveState({ value: 'nope', context: {}, history: [] }));
});

test('unguarded/unknown events are no-ops', () => {
  const m = createSignupMachine();
  const s = m.initialState();
  const r = m.transition(s, { type: 'DOES_NOT_EXIST' });
  assert.equal(r.changed, false);
  assert.equal(r.state, s);
});
