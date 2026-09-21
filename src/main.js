import {
  BRANCHES,
  fieldConfig,
  fieldsForStep,
  getStep,
  mergedSubmission,
  visibleSteps
} from './form/config.js';
import { FormController } from './form/formController.js';
import {
  createShareUrl,
  readSharedSnapshot
} from './form/share.js';
import { serializableSnapshot, STATUSES } from './form/machine.js';

const elements = {
  form: document.querySelector('#form'),
  nav: document.querySelector('#stepNav'),
  badge: document.querySelector('#statusBadge'),
  snapshot: document.querySelector('#snapshotPreview'),
  draftMeta: document.querySelector('#draftMeta'),
  share: document.querySelector('#shareButton'),
  exportButton: document.querySelector('#exportButton'),
  importButton: document.querySelector('#importButton'),
  importFile: document.querySelector('#importFile'),
  reset: document.querySelector('#resetButton'),
  slowToggle: document.querySelector('#slowToggle'),
  toast: document.querySelector('#toast')
};

const controller = new FormController({
  workerUrl: new URL('./workers/validationWorker.js', import.meta.url)
});

let toastTimer = 0;

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function render(state) {
  const activeField = document.activeElement?.name;
  const selectionStart = document.activeElement?.selectionStart;
  const selectionEnd = document.activeElement?.selectionEnd;
  renderStatus(state);
  renderNavigation(state);
  renderForm(state);
  renderInspector(state);
  if (activeField) {
    const control = elements.form.elements.namedItem(activeField);
    if (control && typeof control.setSelectionRange === 'function') {
      control.focus();
      control.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function renderStatus(state) {
  const labels = {
    [STATUSES.IDLE]: controller.lastSavedAt ? `草稿已保存 ${new Date(controller.lastSavedAt).toLocaleTimeString()}` : '草稿就绪',
    [STATUSES.VALIDATING]: `Worker 校验中：${state.pendingFields.join('、') || '...'}`,
    [STATUSES.SUBMITTING]: '提交中，请求 ID 已纳入状态机保护',
    [STATUSES.SUCCESS]: `提交成功：${state.result?.reference ?? ''}`
  };
  elements.badge.textContent = labels[state.status] ?? labels[STATUSES.IDLE];
  elements.badge.className = `status-badge ${state.status}`;
}

function renderNavigation(state) {
  const visible = visibleSteps(state.branch);
  elements.nav.replaceChildren(...visible.map((stepId, index) => {
    const step = getStep(stepId);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'step-pill';
    pill.textContent = `${index + 1}. ${step.title}`;
    if (stepId === state.currentStep) pill.classList.add('current');
    const currentIndex = visible.indexOf(state.currentStep);
    if (index < currentIndex && state.status !== STATUSES.SUCCESS) {
      pill.classList.add('visitable');
      pill.addEventListener('click', () => void controller.goToStep(stepId, { validateStep: false }));
    }
    return pill;
  }));
}

function renderForm(state) {
  if (state.status === STATUSES.SUCCESS) {
    renderSuccess(state);
    return;
  }

  const step = getStep(state.currentStep);
  elements.form.replaceChildren();

  const intro = document.createElement('div');
  intro.className = 'step-intro';
  intro.innerHTML = `<h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.description)}</p>`;
  elements.form.append(intro);

  if (state.currentStep === 'review') renderReview(state);

  for (const field of fieldsForStep(state.currentStep)) {
    elements.form.append(renderField(state, field));
  }

  if (state.submitError) {
    const error = document.createElement('div');
    error.className = 'error';
    error.textContent = state.submitError;
    elements.form.append(error);
  }

  renderActions(state);
}

function renderField(state, fieldName) {
  const config = fieldConfig[fieldName];
  const value = state.values[fieldName];
  const wrapper = document.createElement('div');
  wrapper.className = config.type === 'checkbox' ? 'field checkbox-field' : 'field';
  if (state.touched[fieldName] && state.errors[fieldName]) wrapper.classList.add('invalid');

  const label = document.createElement('label');
  label.htmlFor = fieldName;
  label.textContent = config.label;

  let control;
  if (config.type === 'select') {
    control = document.createElement('select');
    control.innerHTML = config.options
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    control.value = value;
  } else if (config.type === 'checkbox') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = value === true;
  } else {
    control = document.createElement('input');
    control.type = config.type;
    if (config.placeholder) control.placeholder = config.placeholder;
    if (config.autocomplete) control.autocomplete = config.autocomplete;
    control.value = value ?? '';
  }

  control.id = fieldName;
  control.name = fieldName;
  control.disabled = state.status === STATUSES.SUBMITTING;
  control.addEventListener('input', () => {
    const nextValue = control.type === 'checkbox' ? control.checked : control.value;
    controller.input(fieldName, nextValue);
  });
  control.addEventListener('blur', () => controller.touch(fieldName));

  const error = document.createElement('div');
  error.className = 'error';
  error.textContent = state.touched[fieldName] ? state.errors[fieldName] ?? '' : '';

  const pending = document.createElement('div');
  pending.className = 'pending-text';
  pending.textContent = state.pendingFields.includes(fieldName) ? '异步校验运行中…' : '';

  if (config.type === 'checkbox') {
    wrapper.append(control, label, error, pending);
  } else {
    wrapper.append(label, control, error, pending);
  }
  return wrapper;
}

function renderReview(state) {
  const submission = mergedSubmission(state.values, state.branch);
  const block = document.createElement('div');
  block.className = 'review-block';
  block.append(...Object.entries(submission.fields).map(([field, value]) => {
    const row = document.createElement('div');
    row.className = 'review-row';
    row.innerHTML = `<span>${escapeHtml(fieldConfig[field]?.label ?? field)}</span><strong>${escapeHtml(value)}</strong>`;
    return row;
  }));

  const otherBranch = state.branch === BRANCHES.EMPLOYEE ? BRANCHES.COMPANY : BRANCHES.EMPLOYEE;
  const note = document.createElement('div');
  note.className = 'branch-note';
  note.textContent = `当前合并 ${state.branch} 分支；切回 ${otherBranch} 时，该分支已填写的数据会原样恢复。`;
  elements.form.append(block, note);
}

function renderActions(state) {
  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const visible = visibleSteps(state.branch);
  const currentIndex = visible.indexOf(state.currentStep);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'secondary';
  back.textContent = '上一步';
  back.disabled = currentIndex === 0 || state.status === STATUSES.SUBMITTING;
  back.addEventListener('click', () => void controller.goToStep(visible[currentIndex - 1], { validateStep: false }));

  actions.append(back);

  if (state.currentStep === 'review') {
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.textContent = state.status === STATUSES.SUBMITTING ? '提交中…' : '提交';
    submit.disabled = [STATUSES.VALIDATING, STATUSES.SUBMITTING].includes(state.status);
    submit.addEventListener('click', async () => {
      const result = await controller.submit();
      if (!result.ok) toast(result.reason === 'invalid' ? '请先修正表单中的错误' : '当前操作被更新的校验请求取代');
    });
    actions.append(submit);
  } else {
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = state.status === STATUSES.VALIDATING ? '校验后继续…' : '下一步';
    next.disabled = state.status === STATUSES.SUBMITTING;
    next.addEventListener('click', async () => {
      const result = await controller.goToStep(visible[currentIndex + 1]);
      if (!result.ok) toast(result.reason === 'invalid' ? '当前步骤仍有错误' : '请等待当前操作完成');
    });
    actions.append(next);
  }

  elements.form.append(actions);
}

function renderSuccess(state) {
  elements.form.replaceChildren();
  const card = document.createElement('div');
  card.className = 'review-block';
  card.innerHTML = `
    <h2>提交成功</h2>
    <p>受理编号：<strong>${escapeHtml(state.result.reference)}</strong></p>
    <p>成功页状态也已写入 IndexedDB，刷新后仍可恢复。</p>
  `;
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = '新建一份表单';
  again.addEventListener('click', () => controller.reset());
  card.append(again);
  elements.form.append(card);
}

function renderInspector(state) {
  const snapshot = serializableSnapshot(state);
  elements.draftMeta.innerHTML = `
    Draft ID：${escapeHtml(snapshot.draftId)}<br>
    更新时间：${escapeHtml(snapshot.updatedAt)}<br>
    当前步骤：${escapeHtml(snapshot.currentStep)} / 分支：${escapeHtml(snapshot.branch)}
  `;
  elements.snapshot.textContent = JSON.stringify(snapshot, null, 2);
}

elements.share.addEventListener('click', async () => {
  await controller.saveNow();
  const url = createShareUrl(serializableSnapshot(controller.getState()));
  await navigator.clipboard.writeText(url);
  toast('分享链接已复制；打开链接会复制为接收者的新草稿');
});

elements.exportButton.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serializableSnapshot(controller.getState()), null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `draft-${controller.getState().draftId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

elements.importButton.addEventListener('click', () => elements.importFile.click());
elements.importFile.addEventListener('change', async () => {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  const snapshot = JSON.parse(await file.text());
  await controller.restoreShared(snapshot);
  history.replaceState(null, '', location.pathname);
  toast('JSON 草稿已恢复为新的本地草稿');
  elements.importFile.value = '';
});

elements.reset.addEventListener('click', () => controller.reset());
elements.slowToggle.addEventListener('change', () => controller.setSlowMode(elements.slowToggle.checked));
elements.form.addEventListener('submit', (event) => event.preventDefault());

window.addEventListener('beforeunload', () => {
  void controller.saveNow();
});

async function boot() {
  const shared = readSharedSnapshot();
  if (shared) {
    await controller.restoreShared(shared);
    history.replaceState(null, '', location.pathname);
    toast('已从分享链接恢复草稿，并另存为你的本地草稿');
  } else {
    const stored = await controller.store.loadMostRecent();
    if (stored) controller.restoreFromState(stored);
  }
  controller.subscribe(render);
  render(controller.getState());
}

void boot();
