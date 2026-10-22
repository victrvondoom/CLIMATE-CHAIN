// Port of the DAO vote rules in projects/rantai-3c-master:
//   - src/contracts/CarbonDAO.sol castVote: the vote window is inclusive; each address votes once;
//     the weight is the voter's token balance (no tokens, no vote); the weight goes to the side chosen.
//   - executeProposal: runs only after the window has ended, once; passed is set only when votesFor
//     is strictly greater than votesAgainst and some vote was cast.
//   - src/utils/governance.ts getProposal: the status shown to members is executed, else passed or
//     rejected once the window ends (majority on the current tally), else active.
// Not ported: the quorum. CarbonDAO.sol declares quorumPercentage = 10 and its comment says quorum
// is checked, but executeProposal never reads it. This port keeps that behaviour and the test says so.

export interface Proposal {
  startTime: number; // seconds since the epoch
  endTime: number;
  votesFor: number; // token weight
  votesAgainst: number;
  voted: Set<string>;
  executed: boolean;
  passed: boolean;
}

export interface Ballot {
  voter: string;
  support: boolean;
  weight: number; // token balance at the time of the vote
  at: number; // seconds since the epoch
}

export function newProposal({ startTime, endTime }: { startTime: number; endTime: number }): Proposal {
  return { startTime, endTime, votesFor: 0, votesAgainst: 0, voted: new Set(), executed: false, passed: false };
}

// Errors carry the contract's revert reason as the message.
export function castVote(p: Proposal, ballot: Ballot): void {
  if (ballot.at < p.startTime) throw new Error('VotingNotStarted');
  if (ballot.at > p.endTime) throw new Error('VotingEnded');
  if (p.voted.has(ballot.voter)) throw new Error('AlreadyVoted');
  if (p.executed) throw new Error('AlreadyExecuted');
  if (!(ballot.weight > 0)) throw new Error('NoVotingPower');
  p.voted.add(ballot.voter);
  if (ballot.support) p.votesFor += ballot.weight;
  else p.votesAgainst += ballot.weight;
}

export function executeProposal(p: Proposal, now: number): void {
  if (!(now > p.endTime)) throw new Error('VotingStillActive');
  if (p.executed) throw new Error('AlreadyExecuted');
  p.executed = true;
  const totalVotes = p.votesFor + p.votesAgainst;
  if (p.votesFor > p.votesAgainst && totalVotes > 0) p.passed = true;
}

export type ProposalStatus = 'active' | 'passed' | 'rejected' | 'executed';

export function proposalStatus(p: Proposal, now: number): ProposalStatus {
  if (p.executed) return 'executed';
  if (now > p.endTime) return p.votesFor > p.votesAgainst ? 'passed' : 'rejected';
  return 'active';
}
