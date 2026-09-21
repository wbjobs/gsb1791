/**
 * Demo form definition: account -> (personal | company) -> review -> done.
 *  - Branching: `account.type` picks the next step via guards.
 *  - Merging: both branches converge on `review`.
 *  - Branch switch safety: formData is one flat map; switching type keeps
 *    the other branch's fields intact.
 */
import { createFormMachine } from './formMachine.js';

export const validators = {
  username: { deps: [] },
  email: { deps: [] },
  confirmEmail: { deps: ['email'] }, // validation dependency: email change re-validates this
  companyName: { deps: [] },
  inviteCode: { deps: [] },
};

export function createSignupMachine() {
  return createFormMachine({
    id: 'signup',
    initial: 'account',
    steps: {
      account: {
        fields: ['username', 'email', 'confirmEmail', 'type'],
        next: [
          { target: 'company', when: (d) => d.type === 'company' },
          { target: 'personal' },
        ],
      },
      personal: {
        fields: ['inviteCode'],
        next: 'review',
      },
      company: {
        fields: ['companyName'],
        next: 'review', // merge point shared with `personal`
      },
      review: {
        fields: [],
        next: 'done',
      },
      done: { final: true },
    },
  });
}
