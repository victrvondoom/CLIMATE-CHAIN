import { describe, expect, it } from 'vitest';
import { allowedActions, checkTransition, TransitionError } from './repair';

// Rules from PLUME backend/app/repair/state_machine.py (mirrors the RepairEscrow contract).
describe('repair lifecycle', () => {
  it('moves a draft through funding, assignment, repair, verification and payment', () => {
    let status = 'DRAFT';
    status = checkTransition('publish', status, 'sponsor');
    expect(status).toBe('OPEN_FOR_FUNDING');
    status = checkTransition('fund', status, 'sponsor');
    expect(status).toBe('FUNDED');
    status = checkTransition('accept', status, 'provider');
    expect(status).toBe('ASSIGNED');
    status = checkTransition('submit_evidence', status, 'provider');
    expect(status).toBe('REPAIR_SUBMITTED');
    status = checkTransition('start_review', status, 'verifier');
    expect(status).toBe('UNDER_VERIFICATION');
    status = checkTransition('decide', status, 'verifier', 'VERIFIED');
    expect(status).toBe('VERIFIED');
    status = checkTransition('release', status, 'sponsor');
    expect(status).toBe('PAID');
  });

  it('refuses an action by a role that does not own it, with 403', () => {
    expect(() => checkTransition('publish', 'DRAFT', 'provider')).toThrow(TransitionError);
    try {
      checkTransition('publish', 'DRAFT', 'provider');
    } catch (e) {
      expect((e as TransitionError).code).toBe(403);
    }
  });

  it('refuses an action from a state it does not start from, with 409', () => {
    try {
      checkTransition('release', 'PAID', 'sponsor');
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as TransitionError).code).toBe(409);
    }
  });

  it('requires a known verification outcome for a decision', () => {
    try {
      checkTransition('decide', 'REPAIR_SUBMITTED', 'verifier', 'MAYBE');
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as TransitionError).code).toBe(400);
    }
  });

  it('lists only the actions a role may take now, sorted', () => {
    expect(allowedActions('REPAIR_SUBMITTED', 'verifier')).toEqual(['decide', 'start_review']);
    expect(allowedActions('FUNDED', 'provider')).toEqual(['accept']);
    expect(allowedActions('PAID', 'sponsor')).toEqual([]);
  });

  it('lets a sponsor refund an expired escrow from any refundable state', () => {
    expect(checkTransition('refund_expired', 'REJECTED', 'sponsor')).toBe('EXPIRED');
    expect(() => checkTransition('refund_expired', 'PAID', 'sponsor')).toThrow(TransitionError);
  });
});
