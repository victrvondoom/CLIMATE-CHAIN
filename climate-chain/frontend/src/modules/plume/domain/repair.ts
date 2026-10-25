// Repair lifecycle, ported from MethaneMend backend/app/repair/state_machine.py. It mirrors the
// RepairEscrow contract's states. The EIP-712 verifier signature and the on-chain funds are not
// modelled here: this is the rule for which action may happen next, nothing more.

export const OUTCOMES = ['VERIFIED', 'REJECTED', 'INCONCLUSIVE', 'ADDITIONAL_EVIDENCE_REQUIRED'] as const;

const RESUBMITTABLE = ['ASSIGNED', 'REJECTED', 'INCONCLUSIVE', 'ADDITIONAL_EVIDENCE_REQUIRED'];
const REFUNDABLE = [
  'FUNDED',
  'ASSIGNED',
  'REPAIR_SUBMITTED',
  'UNDER_VERIFICATION',
  'REJECTED',
  'INCONCLUSIVE',
  'ADDITIONAL_EVIDENCE_REQUIRED',
  'DISPUTED',
];

interface Transition {
  sources: readonly string[];
  target: string; // '*' for a decision, whose target comes from the outcome
  roles: readonly string[];
}

const TRANSITIONS: Record<string, Transition> = {
  publish: { sources: ['DRAFT'], target: 'OPEN_FOR_FUNDING', roles: ['sponsor'] },
  fund: { sources: ['OPEN_FOR_FUNDING'], target: 'FUNDED', roles: ['sponsor'] },
  accept: { sources: ['FUNDED'], target: 'ASSIGNED', roles: ['provider'] },
  submit_evidence: { sources: RESUBMITTABLE, target: 'REPAIR_SUBMITTED', roles: ['provider'] },
  start_review: { sources: ['REPAIR_SUBMITTED'], target: 'UNDER_VERIFICATION', roles: ['verifier'] },
  decide: { sources: ['REPAIR_SUBMITTED', 'UNDER_VERIFICATION', 'DISPUTED'], target: '*', roles: ['verifier'] },
  dispute: { sources: ['VERIFIED', 'REJECTED', 'INCONCLUSIVE'], target: 'DISPUTED', roles: ['sponsor', 'provider'] },
  release: { sources: ['VERIFIED'], target: 'PAID', roles: ['sponsor', 'provider', 'verifier', 'admin'] },
  cancel: { sources: ['DRAFT', 'OPEN_FOR_FUNDING', 'FUNDED'], target: 'CANCELLED', roles: ['sponsor'] },
  refund_expired: { sources: REFUNDABLE, target: 'EXPIRED', roles: ['sponsor'] },
};

export class TransitionError extends Error {
  readonly code: number; // 400 bad input, 403 wrong role, 409 wrong state

  constructor(message: string, code: number) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
  }
}

// Returns the status after the action, or throws a TransitionError.
export function checkTransition(action: string, current: string, role: string, outcome?: string): string {
  const t = TRANSITIONS[action];
  if (!t) throw new TransitionError(`unknown action ${action}`, 400);
  if (!t.roles.includes(role)) throw new TransitionError(`role '${role}' may not perform '${action}'`, 403);
  if (!t.sources.includes(current)) throw new TransitionError(`cannot ${action} a project in state ${current}`, 409);
  if (action === 'decide') {
    if (!outcome || !(OUTCOMES as readonly string[]).includes(outcome)) {
      throw new TransitionError(`invalid verification outcome ${outcome ?? '(none)'}`, 400);
    }
    return outcome;
  }
  return t.target;
}

// The actions this role may take from this state, sorted.
export function allowedActions(current: string, role: string): string[] {
  return Object.keys(TRANSITIONS)
    .filter((a) => TRANSITIONS[a].sources.includes(current) && TRANSITIONS[a].roles.includes(role))
    .sort();
}
