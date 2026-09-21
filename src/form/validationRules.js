import { BRANCHES } from './config.js';

const postalPatterns = {
  CN: /^\d{6}$/,
  US: /^\d{5}(?:-\d{4})?$/,
  SG: /^\d{6}$/
};

const required = (value) => (value === undefined || value === null || value === '' ? '此项为必填项' : '');

const asNumber = (value) => Number(value);

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Validation aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Validation aborted', 'AbortError'));
    }, { once: true });
  });
}

async function remoteUsername(value, { signal, slow = false }) {
  await delay(slow ? 1200 : 500, signal);
  return ['admin', 'taken'].includes(String(value).toLowerCase())
    ? '该用户名已被占用'
    : '';
}

async function remoteEmail(value, { signal, slow = false }) {
  await delay(slow ? 900 : 350, signal);
  return value === 'reserved@blocked.com' ? '该邮箱不能用于注册' : '';
}

async function remoteRegistrationProof(value, { signal, slow = false }) {
  await delay(slow ? 1400 : 600, signal);
  return /invalid/i.test(value) ? '登记凭证未通过工商系统核验' : '';
}

export const validationRules = [
  {
    field: 'accountType',
    validate: (value) => required(value) || (Object.values(BRANCHES).includes(value) ? '' : '分支类型无效')
  },
  {
    field: 'username',
    async: true,
    validate: async (value, _values, options) => {
      const syncError = required(value) || (String(value).length >= 4 ? '' : '至少输入 4 个字符');
      return syncError || remoteUsername(value, options);
    }
  },
  {
    field: 'email',
    async: true,
    validate: async (value, _values, options) => {
      const syncError = required(value) || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : '请输入有效邮箱');
      return syncError || remoteEmail(value, options);
    }
  },
  {
    field: 'country',
    validate: (value) => required(value) || (postalPatterns[value] ? '' : '不支持的国家或地区')
  },
  {
    field: 'fullName',
    validate: (value) => required(value) || (String(value).trim().length >= 2 ? '' : '至少输入 2 个字符')
  },
  {
    field: 'postalCode',
    dependencies: ['country'],
    validate: (value, values) => {
      const requiredError = required(value);
      if (requiredError) return requiredError;
      const pattern = postalPatterns[values.country];
      return pattern.test(String(value).trim()) ? '' : '邮编格式与所选国家不匹配';
    }
  },
  {
    field: 'employeeId',
    validate: (value) => required(value) || (/^EMP-\d{5}$/.test(value) ? '' : '工号格式应为 EMP-12345')
  },
  {
    field: 'monthlySalary',
    validate: (value) => {
      const requiredError = required(value);
      if (requiredError) return requiredError;
      const salary = asNumber(value);
      return Number.isFinite(salary) && salary > 0 ? '' : '月薪必须是正数';
    }
  },
  {
    field: 'benefitCoverage',
    dependencies: ['monthlySalary'],
    validate: (value, values) => {
      const requiredError = required(value);
      if (requiredError) return requiredError;
      const benefit = asNumber(value);
      const salary = asNumber(values.monthlySalary);
      if (!Number.isFinite(benefit) || benefit < 0) return '福利额度不能为负数';
      if (!Number.isFinite(salary) || salary <= 0) return '请先填写有效月薪';
      return benefit <= salary ? '' : '福利额度不能高于月薪';
    }
  },
  {
    field: 'companyName',
    validate: (value) => required(value) || (String(value).trim().length >= 2 ? '' : '企业名称至少 2 个字符')
  },
  {
    field: 'taxId',
    dependencies: ['country'],
    validate: (value, values) => {
      const requiredError = required(value);
      if (requiredError) return requiredError;
      const normalized = String(value).trim().toUpperCase();
      if (values.country === 'CN') {
        return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalized) ? '' : '中国大陆税号应为 18 位有效代码';
      }
      if (values.country === 'US') {
        return /^\d{2}-?\d{7}$/.test(normalized) ? '' : '美国 EIN 格式应为 12-3456789';
      }
      return /^[0-9A-Z]{9}$/.test(normalized) ? '' : '新加坡企业税号应为 9 位字母或数字';
    }
  },
  {
    field: 'registrationProof',
    async: true,
    validate: async (value, _values, options) => {
      const syncError = required(value) || (String(value).trim().length >= 4 ? '' : '凭证编号至少 4 个字符');
      return syncError || remoteRegistrationProof(value, options);
    }
  },
  {
    field: 'agree',
    validate: (value) => (value === true ? '' : '提交前必须确认信息')
  }
];

export const ruleByField = new Map(validationRules.map((rule) => [rule.field, rule]));

export function dependentsOf(field) {
  return validationRules
    .filter((rule) => rule.dependencies?.includes(field))
    .map((rule) => rule.field);
}

export function hasAsyncRule(field) {
  return ruleByField.get(field)?.async === true;
}

export async function validateFields(fields, values, options = {}) {
  const signal = options.signal;
  const entries = await Promise.all([...new Set(fields)].map(async (field) => {
    const rule = ruleByField.get(field);
    if (!rule) return [field, ''];
    const message = await rule.validate(values[field], values, { signal, slow: options.slow });
    return [field, message || ''];
  }));
  return Object.fromEntries(entries);
}
