import {
  BRANCHES,
  STEPS,
  initialValues,
  visibleSteps
} from './config.js';
import { dependentsOf } from './validationRules.js';

export const STATUSES = {
  IDLE: 'idle',
  VALIDATING: 'validating',
  SUBMITTING: 'submitting',
  SUCCESS: 'success'
};

export function createId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

export function createInitialSnapshot(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    draftId: createId('draft'),
    createdAt: now,
    updatedAt: now,
    status: STATUSES.IDLE,
    currentStep: STEPS.ACCOUNT,
    branch: BRANCHES.EMPLOYEE,
    values: { ...initialValues },
    errors: {},
    touched: {},
    completedSteps: [],
    validationJobs: {},
    pendingFields: [],
    submitId: null,
    submitError: '',
    result: null,
    ...overrides
  };
}

export function sanitizeSnapshot(snapshot) {
  const base = createInitialSnapshot();
  const restored = {
    ...base,
    ...snapshot,
    values: { ...initialValues, ...(snapshot.values ?? {}) },
    errors: sanitizeErrorMap(snapshot.errors ?? {}),
    touched: { ...(snapshot.touched ?? {}) },
    completedSteps: [...(snapshot.completedSteps ?? [])],
    validationJobs: {},
    pendingFields: [],
    submitId: null,
    submitError: ''
  };

  if (!visibleSteps(restored.branch).includes(restored.currentStep)) {
    restored.currentStep = STEPS.ACCOUNT;
  }
  if ([STATUSES.VALIDATING, STATUSES.SUBMITTING].includes(restored.status)) {
    restored.status = STATUSES.IDLE;
  }
  return restored;
}

export function serializableSnapshot(snapshot) {
  return sanitizeSnapshot(snapshot);
}

function sanitizeErrorMap(errors) {
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => typeof message === 'string' && message.length > 0)
  );
}

function touchTime() {
  return new Date().toISOString();
}

function unique(items) {
  return [...new Set(items)];
}

function pendingFieldsFromJobs(jobs) {
  return unique(Object.values(jobs).flatMap((job) => job.fields)).sort();
}

function removeMatchingJobs(jobs, fields) {
  const fieldSet = new Set(fields);
  return Object.fromEntries(
    Object.entries(jobs).filter(([, job]) => !job.fields.some((field) => fieldSet.has(field)))
  );
}

export function transition(snapshot, event) {
  switch (event.type) {
    case 'INPUT':
      return handleInput(snapshot, event);
    case 'TOUCH':
      return {
        ...snapshot,
        touched: { ...snapshot.touched, [event.field]: true },
        updatedAt: touchTime()
      };
    case 'VALIDATION_STARTED':
      return handleValidationStarted(snapshot, event);
    case 'VALIDATION_SETTLED':
      return handleValidationSettled(snapshot, event);
    case 'VALIDATION_ABORTED':
      return handleValidationAborted(snapshot, event);
    case 'VALIDATION_FAILED':
      return handleValidationFailed(snapshot, event);
    case 'NAVIGATE':
      return handleNavigate(snapshot, event);
    case 'SUBMIT_STARTED':
      return {
        ...snapshot,
        status: STATUSES.SUBMITTING,
        submitId: event.submitId,
        submitError: '',
        updatedAt: touchTime()
      };
    case 'SUBMIT_SUCCESS':
      if (snapshot.submitId !== event.submitId) return snapshot;
      return {
        ...snapshot,
        status: STATUSES.SUCCESS,
        result: event.result,
        submitId: null,
        updatedAt: touchTime()
      };
    case 'SUBMIT_FAILURE':
      if (snapshot.submitId !== event.submitId) return snapshot;
      return {
        ...snapshot,
        status: STATUSES.IDLE,
        submitId: null,
        submitError: event.message,
        updatedAt: touchTime()
      };
    case 'DRAFT_RESTORED':
      return sanitizeSnapshot(event.snapshot);
    case 'RESET_DRAFT':
      return createInitialSnapshot({ previousDraftId: snapshot.draftId });
    default:
      return snapshot;
  }
}

function handleInput(snapshot, { field, value }) {
  if (snapshot.status === STATUSES.SUBMITTING) return snapshot;

  const values = { ...snapshot.values, [field]: value };
  let currentStep = snapshot.currentStep;
  let branch = snapshot.branch;
  let completedSteps = snapshot.completedSteps;
  let touched = { ...snapshot.touched, [field]: true };
  const errors = { ...snapshot.errors };
  delete errors[field];

  if (field === 'accountType' && Object.values(BRANCHES).includes(value)) {
    const branchChanged = branch !== value;
    branch = value;
    if (branchChanged) {
      if ([STEPS.EMPLOYEE, STEPS.COMPANY, STEPS.REVIEW].includes(snapshot.currentStep)) {
        currentStep = value;
      }
      completedSteps = completedSteps.filter((step) => step !== STEPS.REVIEW);
      delete errors.agree;
      delete touched.agree;
      values.agree = false;
    }
  }

  for (const dependent of dependentsOf(field)) {
    if (touched[dependent]) {
      delete errors[dependent];
    }
  }

  return {
    ...snapshot,
    status: STATUSES.IDLE,
    result: null,
    currentStep,
    branch,
    values,
    errors,
    touched,
    completedSteps,
    updatedAt: touchTime()
  };
}

function handleValidationStarted(snapshot, { requestId, fields, reason }) {
  const jobs = removeMatchingJobs(snapshot.validationJobs, fields);
  jobs[requestId] = {
    id: requestId,
    fields: unique(fields),
    reason,
    startedAt: new Date().toISOString()
  };
  return {
    ...snapshot,
    status: STATUSES.VALIDATING,
    validationJobs: jobs,
    pendingFields: pendingFieldsFromJobs(jobs),
    updatedAt: touchTime()
  };
}

function handleValidationSettled(snapshot, { requestId, errors: incomingErrors }) {
  const job = snapshot.validationJobs[requestId];
  if (!job) return snapshot;

  const jobs = { ...snapshot.validationJobs };
  delete jobs[requestId];
  const errors = { ...snapshot.errors };
  for (const field of job.fields) {
    const message = incomingErrors[field] ?? '';
    if (message) errors[field] = message;
    else delete errors[field];
  }

  return {
    ...snapshot,
    status: Object.keys(jobs).length > 0 ? STATUSES.VALIDATING : STATUSES.IDLE,
    validationJobs: jobs,
    pendingFields: pendingFieldsFromJobs(jobs),
    errors,
    updatedAt: touchTime()
  };
}

function handleValidationAborted(snapshot, { requestId }) {
  if (!snapshot.validationJobs[requestId]) return snapshot;
  const jobs = { ...snapshot.validationJobs };
  delete jobs[requestId];
  return {
    ...snapshot,
    status: Object.keys(jobs).length > 0 ? STATUSES.VALIDATING : STATUSES.IDLE,
    validationJobs: jobs,
    pendingFields: pendingFieldsFromJobs(jobs),
    updatedAt: touchTime()
  };
}

function handleValidationFailed(snapshot, { requestId, message }) {
  if (!snapshot.validationJobs[requestId]) return snapshot;
  const jobs = { ...snapshot.validationJobs };
  const failedFields = jobs[requestId].fields;
  delete jobs[requestId];
  const errors = { ...snapshot.errors };
  for (const field of failedFields) {
    errors[field] = message || '校验服务暂不可用，请稍后重试';
  }
  return {
    ...snapshot,
    status: Object.keys(jobs).length > 0 ? STATUSES.VALIDATING : STATUSES.IDLE,
    validationJobs: jobs,
    pendingFields: pendingFieldsFromJobs(jobs),
    errors,
    updatedAt: touchTime()
  };
}

function handleNavigate(snapshot, { step }) {
  const visible = visibleSteps(snapshot.branch);
  if (!visible.includes(step)) return snapshot;

  const currentStep = step;
  const completedSteps = snapshot.currentStep === step
    ? snapshot.completedSteps
    : unique([...snapshot.completedSteps.filter((item) => item !== STEPS.REVIEW || step !== STEPS.REVIEW), snapshot.currentStep]);

  return {
    ...snapshot,
    currentStep,
    completedSteps,
    updatedAt: touchTime()
  };
}

export function createFormMachine({ send: externalSend } = {}) {
  let snapshot = createInitialSnapshot();
  const listeners = new Set();

  const service = {
    getState: () => snapshot,
    send(event) {
      const next = transition(snapshot, event);
      if (next !== snapshot) {
        snapshot = next;
        listeners.forEach((listener) => listener(snapshot));
      }
      externalSend?.(event, snapshot);
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    replaceState(nextSnapshot) {
      snapshot = sanitizeSnapshot(nextSnapshot);
      listeners.forEach((listener) => listener(snapshot));
      return snapshot;
    }
  };
  return service;
}
