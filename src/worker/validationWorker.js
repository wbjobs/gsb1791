/**
 * Validation Web Worker.
 * Protocol:  in  { id, field, value, data }
 *            out { id, field, error }
 * Async validators run off the main thread; the main thread's token guard
 * (validation.js) is what actually prevents races — the worker just computes.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Simulated "server" checks with latency.
const TAKEN_USERNAMES = new Set(['admin', 'root', 'test', 'taken']);
const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'tempmail.dev']);

const validators = {
  async username(value) {
    await sleep(400); // simulated network latency
    if (!value) return '用户名必填';
    if (!/^[a-zA-Z][a-zA-Z0-9_]{2,15}$/.test(value)) return '3-16 位，字母开头，仅字母数字下划线';
    if (TAKEN_USERNAMES.has(value.toLowerCase())) return '用户名已被占用';
    return null;
  },
  async email(value) {
    await sleep(300);
    if (!value) return '邮箱必填';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '邮箱格式不正确';
    const domain = value.split('@')[1].toLowerCase();
    if (DISPOSABLE_DOMAINS.has(domain)) return '不支持一次性邮箱域名';
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
    if (!value) return null; // optional
    if (!/^[A-Z0-9]{6}$/.test(value)) return '邀请码为 6 位大写字母或数字';
    return null;
  },
};

self.onmessage = async (e) => {
  const { id, field, value, data } = e.data;
  const fn = validators[field];
  let error = null;
  try {
    error = fn ? await fn(value, data) : null;
  } catch (err) {
    error = String(err?.message ?? err);
  }
  self.postMessage({ id, field, error });
};
