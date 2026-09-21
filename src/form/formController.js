import { branchFields, commonFields, fieldsForStep, mergedSubmission } from './config.js';
import { DraftStore } from './draftStore.js';
import {
  STATUSES,
  createId,
  createFormMachine,
  serializableSnapshot
} from './machine.js';
import { submitApplication } from './api.js';
import { dependentsOf, ruleByField } from './validationRules.js';
import { WorkerValidationClient } from './validationClient.js';

const INPUT_DEBOUNCE_MS = 180;

function dependenciesFor(fields) {
  return new Set(fields.flatMap((field) => ruleByField.get(field)?.dependencies ?? []));
}

export class FormController {
  constructor({ workerUrl, store = new DraftStore(), client } = {}) {
    this.machine = createFormMachine();
    this.client = client ?? new WorkerValidationClient(workerUrl);
    this.store = store;
    this.timers = new Map();
    this.slow = false;
    this.saveTimer = 0;
    this.saveInFlight = Promise.resolve();
    this.lastSavedAt = '';

    this.machine.subscribe((snapshot) => this.scheduleSave(snapshot));
  }

  getState() {
    return this.machine.getState();
  }

  subscribe(listener) {
    return this.machine.subscribe(listener);
  }

  setSlowMode(enabled) {
    this.slow = enabled;
  }

  input(field, value) {
    this.machine.send({ type: 'INPUT', field, value });
    const snapshot = this.getState();
    const dependentFields = dependentsOf(field)
      .filter((dependent) => snapshot.touched[dependent]);
    this.scheduleValidation([field, ...dependentFields], 'input');
  }

  touch(field) {
    this.machine.send({ type: 'TOUCH', field });
    this.validate([field], 'blur');
  }

  async validate(fields, reason = 'manual') {
    const uniqueFields = [...new Set(fields)].filter((field) => ruleByField.has(field));
    this.cancelTimersFor(uniqueFields);

    const before = this.getState();
    const requestId = createId('validation');
    const signature = this.signature(uniqueFields, before.values);
    this.abortJobsFor(uniqueFields);
    this.machine.send({ type: 'VALIDATION_STARTED', requestId, fields: uniqueFields, reason });

    try {
      const result = await this.client.validate({
        requestId,
        fields: uniqueFields,
        values: this.getState().values,
        slow: this.slow,
        signature
      });
      const latest = this.getState();
      const isCurrent = latest.validationJobs[requestId];
      const signatureMatches = this.signature(uniqueFields, latest.values) === signature;
      if (!isCurrent || !signatureMatches) {
        this.client.abort(requestId);
        if (isCurrent) {
          this.machine.send({ type: 'VALIDATION_ABORTED', requestId });
        }
        return null;
      }
      this.machine.send({
        type: 'VALIDATION_SETTLED',
        requestId,
        errors: result.errors
      });
      return result.errors;
    } catch (error) {
      if (error.name === 'ValidationWorkerError') {
        this.machine.send({
          type: 'VALIDATION_FAILED',
          requestId,
          message: error.message
        });
      } else if (error.name !== 'AbortError') {
        this.machine.send({ type: 'VALIDATION_ABORTED', requestId });
      }
      return null;
    }
  }

  scheduleValidation(fields, reason) {
    const uniqueFields = [...new Set(fields)].filter((field) => ruleByField.has(field));
    this.cancelTimersFor(uniqueFields);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.validate(uniqueFields, reason);
    }, INPUT_DEBOUNCE_MS);
    this.timers.set(timer, { fields: uniqueFields });
  }

  cancelTimersFor(fields) {
    const incoming = new Set(fields);
    for (const [timer, timerState] of this.timers) {
      if (timerState.fields.some((field) => incoming.has(field))) {
        clearTimeout(timer);
        this.timers.delete(timer);
      }
    }
  }

  abortJobsFor(fields) {
    const incoming = new Set(fields);
    for (const [requestId, job] of Object.entries(this.getState().validationJobs)) {
      if (job.fields.some((field) => incoming.has(field))) {
        this.client.abort(requestId);
      }
    }
  }

  signature(fields, values) {
    const watched = new Set(fields);
    for (const field of fields) dependenciesFor([field]).forEach((dependency) => watched.add(dependency));
    return JSON.stringify([...watched].sort().map((field) => [field, values[field] ?? null]));
  }

  async goToStep(step, { validateStep = true } = {}) {
    const state = this.getState();
    if (state.status === STATUSES.SUBMITTING && validateStep) {
      return { ok: false, reason: 'busy' };
    }

    if (validateStep) {
      const fields = this.fieldsForCurrentStep();
      const errors = await this.validate(fields, 'navigation');
      if (!errors) return { ok: false, reason: 'superseded' };
      if (Object.values(errors).some(Boolean)) {
        this.markTouched(fields);
        return { ok: false, reason: 'invalid' };
      }
    }

    this.machine.send({ type: 'NAVIGATE', step });
    return { ok: true };
  }

  fieldsForCurrentStep() {
    return fieldsForStep(this.getState().currentStep);
  }

  markTouched(fields) {
    for (const field of fields) {
      this.machine.send({ type: 'TOUCH', field });
    }
  }

  async submit() {
    if (this.getState().status === STATUSES.SUBMITTING) return { ok: false, reason: 'submitting' };
    const fields = [...new Set([
      ...this.commonAndBranchFields(),
      'agree'
    ])];
    this.markTouched(fields);
    const errors = await this.validate(fields, 'submit');
    if (!errors || Object.values(errors).some(Boolean)) {
      return { ok: false, reason: 'invalid' };
    }

    const submitId = createId('submit');
    this.machine.send({ type: 'SUBMIT_STARTED', submitId });
    try {
      const state = this.getState();
      const result = await submitApplication(mergedSubmission(state.values, state.branch));
      if (this.getState().submitId !== submitId) return { ok: false, reason: 'superseded' };
      this.machine.send({ type: 'SUBMIT_SUCCESS', submitId, result });
      await this.saveNow();
      return { ok: true, result };
    } catch (error) {
      if (this.getState().submitId === submitId) {
        this.machine.send({
          type: 'SUBMIT_FAILURE',
          submitId,
          message: error.message || '提交失败'
        });
      }
      return { ok: false, reason: error.message };
    }
  }

  commonAndBranchFields() {
    const state = this.getState();
    return [...commonFields(), ...branchFields(state.branch)];
  }

  async restore(snapshot) {
    this.machine.send({ type: 'DRAFT_RESTORED', snapshot });
    await this.saveNow();
    return this.getState();
  }

  async restoreShared(snapshot) {
    const restored = serializableSnapshot(snapshot);
    restored.draftId = createId('draft');
    restored.sharedFromDraftId = snapshot.draftId;
    restored.createdAt = new Date().toISOString();
    this.machine.replaceState(restored);
    await this.saveNow();
    return this.getState();
  }

  async reset() {
    const previousDraftId = this.getState().draftId;
    this.machine.send({ type: 'RESET_DRAFT' });
    clearTimeout(this.saveTimer);
    await this.saveInFlight.catch(() => undefined);
    await this.store.remove(previousDraftId).catch(() => undefined);
    await this.saveNow();
  }

  restoreFromState(snapshot) {
    this.machine.replaceState(snapshot);
  }

  serializableState() {
    return serializableSnapshot(this.getState());
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 250);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    const snapshot = this.serializableState();
    this.saveInFlight = this.saveInFlight
      .catch(() => undefined)
      .then(async () => {
        await this.store.save(snapshot);
        this.lastSavedAt = new Date().toISOString();
      });
    return this.saveInFlight;
  }

  destroy() {
    clearTimeout(this.saveTimer);
    for (const timer of this.timers.keys()) clearTimeout(timer);
    this.client.terminate();
  }
}
