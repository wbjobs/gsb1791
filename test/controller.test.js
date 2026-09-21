import test from 'node:test';
import assert from 'node:assert/strict';
import { FormController } from '../src/form/formController.js';

class FakeValidationClient {
  constructor() {
    this.pending = new Map();
    this.aborted = [];
  }

  validate(request) {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { request, resolve, reject });
    });
  }

  abort(requestId) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.aborted.push(requestId);
    pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  }

  resolve(requestId, errors) {
    this.pending.get(requestId)?.resolve({ requestId, errors });
  }
}

class FakeStore {
  constructor() {
    this.saved = [];
  }

  async save(snapshot) {
    this.saved.push(snapshot);
  }
}

test('重叠的异步校验请求取消旧任务，且只有当前响应能写入错误', async () => {
  const client = new FakeValidationClient();
  const store = new FakeStore();
  const controller = new FormController({ client, store });

  const oldValidation = controller.validate(['username'], 'input');
  const oldId = [...client.pending.keys()][0];

  const newValidation = controller.validate(['username'], 'input');
  const newId = [...client.pending.keys()][0];

  assert.deepEqual(client.aborted, [oldId]);
  assert.notEqual(oldId, newId);
  assert.deepEqual(Object.keys(controller.getState().validationJobs), [newId]);

  client.resolve(newId, { username: '当前请求错误' });
  const newErrors = await newValidation;
  await oldValidation.catch(() => undefined);

  assert.equal(newErrors.username, '当前请求错误');
  assert.equal(controller.getState().errors.username, '当前请求错误');
});

test('分享快照恢复时复制为新的草稿并保留表单值', async () => {
  const client = new FakeValidationClient();
  const store = new FakeStore();
  const controller = new FormController({ client, store });
  controller.input('username', 'shared-user');
  const shared = controller.serializableState();

  const restoredController = new FormController({
    client: new FakeValidationClient(),
    store: new FakeStore()
  });
  await restoredController.restoreShared(shared);

  assert.notEqual(restoredController.getState().draftId, shared.draftId);
  assert.equal(restoredController.getState().values.username, 'shared-user');
  assert.equal(restoredController.getState().sharedFromDraftId, shared.draftId);
});
