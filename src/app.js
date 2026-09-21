import { createSignupMachine, validators } from './signupForm.js';
import { createFormController } from './controller.js';
import { createValidationClient } from './validationClient.js';
import { createDraftStore } from './storage.js';

const FIELD_META = {
  username: { label: '用户名', input: 'text' },
  email: { label: '邮箱', input: 'text' },
  confirmEmail: { label: '确认邮箱', input: 'text' },
  type: { label: '账户类型', input: 'select', options: [['personal', '个人'], ['company', '企业']] },
  inviteCode: { label: '邀请码（可选）', input: 'text' },
  companyName: { label: '公司名称', input: 'text' },
};

const machine = createSignupMachine();
const controller = createFormController({
  machine,
  validators,
  runValidation: createValidationClient('./src/worker/validationWorker.js'),
  draftStore: createDraftStore(),
  draftId: 'signup-demo',
});

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function renderFields(snapshot) {
  const box = $('fields');
  box.querySelectorAll('[data-field]').forEach((n) => n.remove());
  $('step-title').textContent = `步骤：${snapshot.value}`;
  for (const field of machine.fieldsOf(snapshot.value)) {
    const meta = FIELD_META[field];
    if (!meta) continue;
    const wrap = document.createElement('div');
    wrap.dataset.field = field;
    const v = snapshot.validation[field];
    const cls = v?.status === 'pending' ? 'pending' : v?.status === 'stale' ? 'stale' : 'err';
    const msg = v?.status === 'pending' ? '校验中…' : v?.status === 'stale' ? '依赖已变更，重新校验…' : v?.error ?? '';
    wrap.innerHTML = `<label>${meta.label}</label>`;
    let input;
    if (meta.input === 'select') {
      input = document.createElement('select');
      for (const [val, text] of meta.options) {
        const o = document.createElement('option');
        o.value = val; o.textContent = text;
        input.append(o);
      }
    } else {
      input = document.createElement('input');
      input.type = meta.input;
    }
    input.value = snapshot.data[field] ?? '';
    input.addEventListener('input', () => controller.change(field, input.value));
    const err = document.createElement('div');
    err.className = cls;
    err.textContent = msg;
    wrap.append(input, err);
    box.append(wrap);
  }
  if (snapshot.value === 'review') {
    const pre = document.createElement('pre');
    pre.dataset.field = '__review';
    pre.textContent = JSON.stringify(snapshot.data, null, 2);
    box.append(pre);
  }
  if (snapshot.isFinal) {
    const p = document.createElement('p');
    p.dataset.field = '__done';
    p.textContent = '✅ 已完成';
    box.append(p);
  }
}

function render(snapshot) {
  renderFields(snapshot);
  $('steps').textContent = `路径：${[...snapshot.state.history, snapshot.value].join(' → ')}`;
  $('back').disabled = !snapshot.canGoBack;
  $('next').disabled = snapshot.isFinal ||
    Object.values(snapshot.validation).some((v) => v.status === 'pending' || v.status === 'invalid');
  statusEl.textContent = `已自动保存到 IndexedDB（draft: signup-demo）· 刷新页面可恢复`;
}

controller.subscribe(render);

$('next').addEventListener('click', () => controller.next());
$('back').addEventListener('click', () => controller.back());
$('reset').addEventListener('click', async () => { await controller.clearDraft(); location.hash = ''; location.reload(); });
$('shareBtn').addEventListener('click', () => {
  const token = controller.shareToken();
  $('share').value = token;
  location.hash = `share=${token}`;
});

// Boot: share token in URL wins; otherwise resume the IndexedDB draft.
if (location.hash.startsWith('#share=')) {
  try {
    controller.restoreFromShareToken(location.hash.slice(7));
    statusEl.textContent = '已从分享链接恢复草稿';
  } catch (e) {
    statusEl.textContent = `分享链接无效：${e.message}`;
  }
} else {
  controller.restoreFromDraft().then((ok) => {
    if (ok) statusEl.textContent = '已从 IndexedDB 恢复草稿';
  });
}
render(controller.getSnapshot());
