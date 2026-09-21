import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormController } from '../src/controller.js';
import { createSignupMachine, validators } from '../src/signupForm.js';
import { createDraftStore, createMemoryBackend } from '../src/storage.js';
import { encodeShareToken, decodeShareToken } from '../src/share.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeController(extra = {}) {
  return createFormController({
    machine: createSignupMachine(),
    validators,
    runValidation: () => null,
    ...extra,
  });
}

test('refresh recovery: serialize mid-flow, restore into a fresh controller', async () => {
  const a = makeController();
  a.change('username', 'alice');
  a.change('type', 'company');
  a.next();
  a.change('companyName', 'Acme');
  await flush();

  const snapshot = a.serialize();
  // Must survive a JSON round-trip (this is what IndexedDB stores).
  const persisted = JSON.parse(JSON.stringify(snapshot));

  const b = makeController();
  b.restore(persisted);
  const snap = b.getSnapshot();
  assert.equal(snap.value, 'company');
  assert.deepEqual(snap.data, { username: 'alice', type: 'company', companyName: 'Acme' });
  // Can keep going exactly where we left off.
  b.next();
  assert.equal(b.getSnapshot().value, 'review');
});

test('draft store: autosave to (injected) IndexedDB backend and resume', async () => {
  const backend = createMemoryBackend();
  const store = createDraftStore(backend);

  const a = makeController({ draftStore: store, draftId: 'd1' });
  a.change('username', 'bob');
  a.change('type', 'personal');
  a.next();
  await sleep(250); // autosave is debounced at 150ms

  const b = makeController({ draftStore: store, draftId: 'd1' });
  const restored = await b.restoreFromDraft();
  assert.equal(restored, true);
  assert.equal(b.getSnapshot().value, 'personal');
  assert.equal(b.getSnapshot().data.username, 'bob');
});

test('share token: full round-trip restores identical state', async () => {
  const a = makeController();
  a.change('username', 'carol');
  a.change('type', 'company');
  a.next();
  a.change('companyName', 'Globex');
  await flush();

  const token = a.shareToken();
  assert.match(token, /^v1\./);

  const b = makeController();
  b.restoreFromShareToken(token);
  assert.equal(b.getSnapshot().value, 'company');
  assert.deepEqual(b.getSnapshot().data, a.getSnapshot().data);
});

test('share token: tampering is detected via checksum', () => {
  const token = encodeShareToken({ v: 1, state: { value: 'account', context: {}, history: [] } });
  const tampered = token.slice(0, -4) + 'xxxx';
  assert.throws(() => decodeShareToken(tampered), /checksum|malformed/);
});

test('pending validations at snapshot time are re-run after restore', async () => {
  const runs = [];
  const a = createFormController({
    machine: createSignupMachine(),
    validators: { username: {} },
    runValidation: () => new Promise(() => {}), // never resolves: stays pending
  });
  a.change('username', 'dave');
  await flush();
  assert.equal(a.getSnapshot().validation.username.status, 'pending');

  const persisted = JSON.parse(JSON.stringify(a.serialize()));

  const b = createFormController({
    machine: createSignupMachine(),
    validators: { username: {} },
    runValidation: (field) => { runs.push(field); return null; },
  });
  b.restore(persisted);
  await flush();
  assert.deepEqual(runs, ['username'], 'pending field revalidated after restore');
  assert.equal(b.getSnapshot().validation.username.status, 'valid');
});

test('back/next navigation through controller keeps data intact', () => {
  const c = makeController();
  c.change('username', 'erin');
  c.change('type', 'company');
  c.next();
  c.change('companyName', 'Initech');
  c.back();
  assert.equal(c.getSnapshot().value, 'account');
  assert.equal(c.getSnapshot().data.companyName, 'Initech');
  c.next();
  assert.equal(c.getSnapshot().value, 'company');
  assert.equal(c.getSnapshot().data.companyName, 'Initech');
});

test('full journey: branch -> merge -> final, serializable the whole way', async () => {
  const c = makeController();
  c.change('username', 'frank');
  c.change('email', 'f@x.com');
  c.change('confirmEmail', 'f@x.com');
  c.change('type', 'personal');
  c.next();
  c.change('inviteCode', 'ABC123');
  c.next();
  assert.equal(c.getSnapshot().value, 'review');
  c.next();
  assert.equal(c.getSnapshot().isFinal, true);
  JSON.parse(JSON.stringify(c.serialize())); // still serializable at the end
});
