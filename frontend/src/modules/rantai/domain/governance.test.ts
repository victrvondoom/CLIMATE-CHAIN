import { describe, expect, it } from 'vitest';
import { castVote, executeProposal, newProposal, proposalStatus, type Proposal } from './governance';
import ballots from '../fixtures/illustrative_ballots.json';

// Rules ported from projects/rantai-3c-master/src/contracts/CarbonDAO.sol (castVote, executeProposal)
// and src/utils/governance.ts (getProposal status). A vote weighs the voter's token balance.

const START = 1000;
const END = 2000;

function open(): Proposal {
  return newProposal({ startTime: START, endTime: END });
}

function codeOf(action: () => unknown): string | 'ok' {
  try {
    action();
    return 'ok';
  } catch (error) {
    return error instanceof Error ? error.message : 'unexpected';
  }
}

describe('castVote', () => {
  it('adds the voter balance to the side voted', () => {
    const p = open();
    castVote(p, { voter: 'a', support: true, weight: 400, at: 1500 });
    castVote(p, { voter: 'b', support: false, weight: 250, at: 1500 });
    expect(p.votesFor).toBe(400);
    expect(p.votesAgainst).toBe(250);
  });

  it('refuses a vote before the window opens, after it closes, twice, after execution, or with no tokens', () => {
    const p = open();
    expect(codeOf(() => castVote(p, { voter: 'a', support: true, weight: 1, at: START - 1 }))).toBe('VotingNotStarted');
    expect(codeOf(() => castVote(p, { voter: 'a', support: true, weight: 1, at: END + 1 }))).toBe('VotingEnded');
    expect(codeOf(() => castVote(p, { voter: 'z', support: true, weight: 0, at: 1500 }))).toBe('NoVotingPower');
    expect(codeOf(() => castVote(p, { voter: 'a', support: true, weight: 5, at: 1500 }))).toBe('ok');
    expect(codeOf(() => castVote(p, { voter: 'a', support: false, weight: 5, at: 1600 }))).toBe('AlreadyVoted');
    executeProposal(p, END + 1);
    expect(codeOf(() => castVote(p, { voter: 'b', support: true, weight: 5, at: END }))).toBe('AlreadyExecuted');
  });
});

describe('executeProposal', () => {
  it('runs only after the voting window has ended, and only once', () => {
    const p = open();
    castVote(p, { voter: 'a', support: true, weight: 5, at: 1500 });
    expect(codeOf(() => executeProposal(p, END))).toBe('VotingStillActive');
    expect(codeOf(() => executeProposal(p, END + 1))).toBe('ok');
    expect(codeOf(() => executeProposal(p, END + 2))).toBe('AlreadyExecuted');
  });

  it('passes on a strict majority, does not pass on a tie, and does not pass with no votes', () => {
    const majority = open();
    castVote(majority, { voter: 'a', support: true, weight: 3, at: 1500 });
    castVote(majority, { voter: 'b', support: false, weight: 2, at: 1500 });
    executeProposal(majority, END + 1);
    expect(majority.passed).toBe(true);

    const tie = open();
    castVote(tie, { voter: 'a', support: true, weight: 2, at: 1500 });
    castVote(tie, { voter: 'b', support: false, weight: 2, at: 1500 });
    executeProposal(tie, END + 1);
    expect(tie.passed).toBe(false);

    const none = open();
    executeProposal(none, END + 1);
    expect(none.passed).toBe(false);
  });

  it('tallies the illustrative ballots: 550 for, 250 against, passed', () => {
    const p = newProposal({ startTime: ballots.proposal.startTime, endTime: ballots.proposal.endTime });
    for (const b of ballots.ballots) castVote(p, { voter: b.voter, support: b.support, weight: b.weight, at: b.at });
    expect(p.votesFor).toBe(550);
    expect(p.votesAgainst).toBe(250);
    executeProposal(p, ballots.proposal.endTime + 1);
    expect(p.passed).toBe(true);
  });
});

describe('status shown to members (governance.ts getProposal)', () => {
  it('is active until the window ends, then passed or rejected by the same majority, and executed after execution', () => {
    const p = open();
    castVote(p, { voter: 'a', support: true, weight: 3, at: 1500 });
    castVote(p, { voter: 'b', support: false, weight: 2, at: 1500 });
    expect(proposalStatus(p, END)).toBe('active');
    expect(proposalStatus(p, END + 1)).toBe('passed');
    executeProposal(p, END + 1);
    expect(proposalStatus(p, END + 2)).toBe('executed');
  });

  it('shows passed before execution, while the contract passed flag is still false (a gap to report)', () => {
    const p = open();
    castVote(p, { voter: 'a', support: true, weight: 3, at: 1500 });
    expect(proposalStatus(p, END + 1)).toBe('passed');
    expect(p.passed).toBe(false);
  });
});

describe('quorum (a gap: declared in the contract, not enforced)', () => {
  it('passes a proposal with one vote of weight 1 out of 1000 supply, although 10 percent quorum is not reached', () => {
    const p = open();
    castVote(p, { voter: 'a', support: true, weight: 1, at: 1500 });
    executeProposal(p, END + 1);
    expect(ballots.proposal.quorumPercentage).toBe(10);
    expect(1 / ballots.proposal.totalSupply).toBeLessThan(ballots.proposal.quorumPercentage / 100);
    expect(p.passed).toBe(true);
  });
});
