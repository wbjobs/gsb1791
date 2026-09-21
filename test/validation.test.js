import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createValidationCoordinator, validationReducer } from '../src/validation.js';
import { createFormController } from '../src/controller.js';
import { createSignupMachine, validators } from '../src/signupForm.js';

/** Deferred promise helper. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('dependency graph: confirmEmail depends on email (transitive closure)', () => {
  const c = createValidationCoordinator(validators, () => null);
  assert.deepEqual(c.affectedBy('email'), ['confirmEmail']);
  assert.deepEqual(c.affectedBy('username'), []);
});

test('async race: out-of-order resolution never applies stale results', async () => {
  const runs = [];
  const coordinator = createValidationCoordinator(
    { username: {} },
    () => { const d = deferred(); runs.push(d); return d.promise; },
  );

  // Two validations for the same field;第一个更慢返回（模拟竞态）。
  const first = coordinator.validate('username', 'adm', {});
  const second = coordinator.validate('username', 'admin', {});

  // Resolve OUT OF ORDER: the newer run resolves first.
  runs[1].resolve(null);            // latest: valid
  runs[0].resolve('too short');     // stale: must be dropped

  const [r1, r2] = await Promise.all([first.promise, second.promise]);
  assert.equal(r1.applied, false, 'stale result must be discarded');
  assert.equal(r2.applied, true);
  assert.equal(r2.error, null);
});

test('controller: changing a dependency marks dependents stale and revalidates', async () => {
  const calls = [];
  const controller = createFormController({
    machine: createSignupMachine(),
    validators,
    runValidation: (field) => { calls.push(field); return null; },
  });

  controller.change('email', 'a@b.com');
  controller.change('confirmEmail', 'a@b.com');
  await flush();
  assert.equal(controller.getSnapshot().validation.confirmEmail.status, 'valid');

  // Change the dependency: confirmEmail must be revalidated.
  calls.length = 0;
  controller.change('email', 'new@b.com');
  await flush();
  assert.ok(calls.includes('confirmEmail'), 'dependent field revalidated');
  assert.equal(controller.getSnapshot().validation.confirmEmail.status, 'valid');
});

test('controller: race across rapid edits — only the last edit wins', async () => {
  const runs = new Map(); // field -> deferred[]
  const controller = createFormController({
    machine: createSignupMachine(),
    validators: { username: {} },
    runValidation: (field) => {
      const d = deferred();
      if (!runs.has(field)) runs.set(field, []);
      runs.get(field).push(d);
      return d.promise;
    },
  });

  controller.change('username', 'a');
  controller.change('username', 'ab');
  controller.change('username', 'abc');
  const [r1, r2, r3] = runs.get('username');

  // Resolve in adversarial order: middle, first, last.
  r2.resolve('stale-middle');
  await flush();
  r1.resolve('stale-first');
  await flush();
  assert.equal(controller.getSnapshot().validation.username.status, 'pending');

  r3.resolve(null);
  await flush();
  assert.equal(controller.getSnapshot().validation.username.status, 'valid');
  assert.equal(controller.getSnapshot().validation.username.error, null);
});

test('controller: validation errors block nothing structurally but are reported', async () => {
  const controller = createFormController({
    machine: createSignupMachine(),
    validators: { username: {} },
    runValidation: () => '用户名已被占用',
  });
  controller.change('username', 'admin');
  await flush();
  const v = controller.getSnapshot().validation.username;
  assert.equal(v.status, 'invalid');
  assert.equal(v.error, '用户名已被占用');
});

test('validationReducer transitions are pure', () => {
  const s0 = {};
  const s1 = validationReducer(s0, { type: 'pending', field: 'x' });
  const s2 = validationReducer(s1, { type: 'resolved', field: 'x', error: 'bad' });
  assert.deepEqual(s0, {});
  assert.equal(s1.x.status, 'pending');
  assert.equal(s2.x.status, 'invalid');
  assert.equal(s2.x.error, 'bad');
});
