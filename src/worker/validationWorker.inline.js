/**
 * Inline mirror of the worker validators, used when Worker is unavailable
 * (Node tests, SSR). Keep logic identical to validationWorker.js.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAKEN_USERNAMES = new Set(['admin', 'root', 'test', 'taken']);
const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'tempmail.dev']);

const validators = {
  async username(value) {
    await sleep(400);
    if (!value) return '用户名必填';
    if (!/^[a-zA-Z][a-zA-Z0-9_]{2,15}$/.test(value)) return '3-16 位，字母开头，仅字母数字下划线';
    if (TAKEN_USERNAMES.has(value.toLowerCase())) return '用户名已被占用';
    return null;
  },
  async email(value) {
    await sleep(300);
    if (!value) return '邮箱必填';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '邮箱格式不正确';
    if (DISPOSABLE_DOMAINS.has(value.split('@')[1].toLowerCase())) return '不支持一次性邮箱域名';
    return null;
  },
  async confirmEmail(value, data) {
    await sleep(50);
    if (value !== data.email) return '两次输入的邮箱不一致';
    return null;
  },
  async companyName(value) {
    await sleep(350);
    if (!value) return '公司名称必填';
    if (value.length < 2) return '公司名称至少 2 个字符';
    return null;
  },
  async inviteCode(value) {
    await sleep(250);
    if (!value) return null;
    if (!/^[A-Z0-9]{6}$/.test(value)) return '邀请码为 6 位大写字母或数字';
    return null;
  },
};

export function validate(field, value, data) {
  const fn = validators[field];
  return fn ? fn(value, data) : null;
}
