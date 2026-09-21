import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCHES,
  initialValues
} from '../src/form/config.js';
import { validateFields } from '../src/form/validationRules.js';

function values(overrides) {
  return { ...initialValues, ...overrides };
}

test('邮编校验依赖国家字段', async () => {
  const cn = await validateFields(['postalCode'], values({ country: 'CN', postalCode: '200000' }));
  const us = await validateFields(['postalCode'], values({ country: 'US', postalCode: '200000' }));
  const sg = await validateFields(['postalCode'], values({ country: 'SG', postalCode: '123456' }));

  assert.equal(cn.postalCode, '');
  assert.match(us.postalCode, /国家/);
  assert.equal(sg.postalCode, '');
});

test('福利额度校验依赖月薪', async () => {
  const valid = await validateFields(
    ['benefitCoverage'],
    values({ monthlySalary: '10000', benefitCoverage: '8000' })
  );
  const invalid = await validateFields(
    ['benefitCoverage'],
    values({ monthlySalary: '5000', benefitCoverage: '8000' })
  );

  assert.equal(valid.benefitCoverage, '');
  assert.match(invalid.benefitCoverage, /月薪/);
});

test('税号规则随国家分支之外的依赖字段变化', async () => {
  const cn = await validateFields(
    ['taxId'],
    values({ accountType: BRANCHES.COMPANY, country: 'CN', taxId: '91310000MA1FL22X0A' })
  );
  const us = await validateFields(
    ['taxId'],
    values({ accountType: BRANCHES.COMPANY, country: 'US', taxId: '12-3456789' })
  );

  assert.equal(cn.taxId, '');
  assert.equal(us.taxId, '');
});

test('AbortSignal 会取消异步远端校验', async () => {
  const controller = new AbortController();
  const validation = validateFields(
    ['username'],
    values({ username: 'someone' }),
    { signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(validation, (error) => error.name === 'AbortError');
});
