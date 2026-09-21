import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCHES,
  STEPS,
  mergedSubmission
} from '../src/form/config.js';
import {
  STATUSES,
  createInitialSnapshot,
  sanitizeSnapshot,
  serializableSnapshot,
  transition
} from '../src/form/machine.js';

const validEmployeeValues = {
  accountType: BRANCHES.EMPLOYEE,
  username: 'alice',
  email: 'alice@example.com',
  country: 'CN',
  fullName: 'Alice',
  postalCode: '200000',
  employeeId: 'EMP-12345',
  monthlySalary: '20000',
  benefitCoverage: '5000',
  companyName: '',
  taxId: '',
  registrationProof: '',
  agree: true
};

test('切换分支时保留两个分支已经填写的数据', () => {
  let state = createInitialSnapshot();
  state = transition(state, { type: 'INPUT', field: 'employeeId', value: 'EMP-12345' });
  state = transition(state, { type: 'INPUT', field: 'accountType', value: BRANCHES.COMPANY });

  assert.equal(state.branch, BRANCHES.COMPANY);
  assert.equal(state.currentStep, STEPS.ACCOUNT);
  state = transition(state, { type: 'NAVIGATE', step: STEPS.COMPANY });
  assert.equal(state.currentStep, STEPS.COMPANY);
  assert.equal(state.values.employeeId, 'EMP-12345');

  state = transition(state, { type: 'INPUT', field: 'companyName', value: 'Example Ltd' });
  state = transition(state, { type: 'INPUT', field: 'accountType', value: BRANCHES.EMPLOYEE });

  assert.equal(state.currentStep, STEPS.EMPLOYEE);
  assert.equal(state.values.employeeId, 'EMP-12345');
  assert.equal(state.values.companyName, 'Example Ltd');
});

test('新的同字段校验开始后，迟到的旧响应不会写入状态', () => {
  let state = createInitialSnapshot();
  state = transition(state, {
    type: 'VALIDATION_STARTED',
    requestId: 'old',
    fields: ['username'],
    reason: 'input'
  });
  assert.deepEqual(state.pendingFields, ['username']);

  state = transition(state, {
    type: 'VALIDATION_STARTED',
    requestId: 'new',
    fields: ['username'],
    reason: 'input'
  });
  assert.deepEqual(Object.keys(state.validationJobs), ['new']);

  const staleState = transition(state, {
    type: 'VALIDATION_SETTLED',
    requestId: 'old',
    errors: { username: '迟到的旧错误' }
  });
  assert.equal(staleState, state);
  assert.equal(staleState.errors.username, undefined);

  state = transition(state, {
    type: 'VALIDATION_SETTLED',
    requestId: 'new',
    errors: { username: '' }
  });
  assert.equal(state.status, STATUSES.IDLE);
  assert.deepEqual(state.pendingFields, []);
});

test('刷新恢复会移除瞬时请求并保留成功态和用户数据', () => {
  const persisted = serializableSnapshot({
    ...createInitialSnapshot(),
    status: STATUSES.VALIDATING,
    values: { ...validEmployeeValues, username: 'bob' },
    errors: { employeeId: 'will remain' },
    validationJobs: { old: { id: 'old', fields: ['username'] } },
    pendingFields: ['username']
  });

  const restored = sanitizeSnapshot(persisted);
  assert.equal(restored.status, STATUSES.IDLE);
  assert.equal(restored.values.username, 'bob');
  assert.equal(restored.errors.employeeId, 'will remain');
  assert.deepEqual(restored.validationJobs, {});
  assert.deepEqual(restored.pendingFields, []);

  const success = sanitizeSnapshot({
    ...persisted,
    status: STATUSES.SUCCESS,
    result: { reference: 'APP-X' }
  });
  assert.equal(success.status, STATUSES.SUCCESS);
  assert.equal(success.result.reference, 'APP-X');
});

test('分支合并只包含通用字段和当前分支字段', () => {
  const merged = mergedSubmission(validEmployeeValues, BRANCHES.EMPLOYEE);
  assert.deepEqual(Object.keys(merged.fields).sort(), [
    'accountType',
    'benefitCoverage',
    'country',
    'email',
    'employeeId',
    'fullName',
    'monthlySalary',
    'postalCode',
    'username'
  ]);
  assert.equal(merged.fields.companyName, undefined);
  assert.equal(merged.agreed, true);
});
