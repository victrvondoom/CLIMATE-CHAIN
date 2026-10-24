// Typed client for the gateway's Climate Integrity Lab routes (/api/v1/integrity).
// Types mirror gateway/integrity-service.mjs and gateway/integrity-evidence.mjs.

export type LedgerMode = 'LOCAL_EVM' | 'OFFLINE';
export type RetrievalMode = 'LIVE_FETCH' | 'CACHED_HISTORICAL_EXAMPLE';
export type SourceMode = 'live-or-cached' | 'live' | 'cached';
export type ClaimStatus = 'None' | 'Submitted' | 'Challenged' | 'Rejected' | 'Superseded';

export interface Guideline { value: number; unit: string; averaging: string; source: string; sourceUrl: string; exceedanceBasis?: string; note?: string }
export interface AnalyteDefinition { id: string; label: string; name: string; identity: string; relevance: string; distinctFrom: string; guideline: Guideline }
export interface Site { id: string; label: string; lat: number; lon: number; country: string; note: string }
export interface ChainProblem { code: string; message: string }

export interface SourceRecord {
  sourceId: string;
  provider: string;
  dataProvider: string;
  product: string;
  dataKind: 'MODEL_FORECAST';
  retrievalMode: RetrievalMode;
  sourceUrl: string;
  documentationUrl: string;
  license: string;
  retrievedAt: string;
  capturedAt: string | null;
  servedAt: string | null;
  reusedRecentResponse: boolean;
  liveError: ChainProblem | null;
  rawPayloadSha256: string;
  rawPayloadBytes: number;
  normalizedPayloadSha256: string;
  grid: { lat: number; lon: number; elevationM: number | null };
  spatialResolution: string;
  temporalResolution: string;
  heightAboveGround: string;
  freshness: { latestValidTimeUtc: string; ageHoursAtRetrieval: number; stale: boolean; rule: string };
  limitations: string[];
}

export interface Measurement { measurementId: string; analyte: string; basis: string; measured: false; series: boolean; value: number | null; unit: string; validTimeUtc: string; missing: string | null }

export interface Derived {
  derivedId: string;
  basis: string;
  formula: string;
  hoursUsed: number;
  hoursMissing: number;
  value: number;
  unit: string;
  guidelineComparison: { guideline: Guideline; exceeds: boolean | null; note: string };
  limitations: string[];
}

export interface EvidenceBundle {
  evidenceId: string;
  schema: string;
  canonicalization: string;
  methodVersion: string;
  claimType: string;
  parentEvidenceId: string | null;
  revisionNote: string | null;
  location: { siteId: string; label: string; lat: number; lon: number; crs: string; precisionDecimals: number; note: string };
  timeframe: { startUtc: string; endUtc: string };
  focusAnalyte: string;
  analyteDefinitions: AnalyteDefinition[];
  sources: SourceRecord[];
  measurements: Measurement[];
  derived: Derived[];
  comparisons: { with: string; status: string; reason: string }[];
  uncertainty: string[];
  canProve: string[];
  cannotProve: string[];
  custody: Record<string, string>[];
}

export interface Recommendation { action: string; why: string; evidenceNeeded: string }

export interface EvidenceProof {
  evidenceId: string;
  evidenceKey: string;
  anchored: boolean;
  chainId: number;
  network: string;
  contractAddress: string;
  onChainDigest?: string;
  metadataHash?: string;
  parentEvidenceId?: string | null;
  supersededByEvidenceId?: string | null;
  current?: boolean;
  attester?: string;
  blockNumber?: number;
  anchoredAt?: string;
  transactionHash?: string | null;
  blockHash?: string | null;
  receiptStatus?: number | null;
  confirmations?: number | null;
  gasUsed?: string | null;
  eventMatchesRecord?: boolean;
  alreadyAnchored?: boolean;
}

export interface EvidenceResponse {
  evidenceId: string;
  digest: string;
  metadataHash: string;
  bundle: EvidenceBundle;
  proof: EvidenceProof | null;
  ledgerMode: LedgerMode;
  chainProblem: ChainProblem | null;
  recommendations: Recommendation[];
}

export interface VerifyCheck { id: string; label: string; ok: boolean; detail: string }
export interface VerifyResponse { evidenceId: string; verified: boolean; ledgerMode: LedgerMode; recomputedDigest: string; checks: VerifyCheck[]; proof: EvidenceProof | null; chainProblem: ChainProblem | null; note: string }

export interface TamperResponse {
  evidenceId: string;
  label: string;
  change: { path: string; measurementId: string; before: number; after: number };
  originalDigest: string;
  tamperedDigest: string;
  onChainDigest: string | null;
  matchesOnChain: boolean | null;
  contractAcceptsTampered: boolean | null;
  contractAcceptsOriginal: boolean | null;
  result: 'PASS' | 'FAIL' | 'NOT_ANCHORED';
  ledgerMode: LedgerMode;
  chainProblem: ChainProblem | null;
}

export interface RejectionResponse {
  rejected: true;
  errorName: string;
  errorArgs: string[];
  method: string;
  from: string;
  contractAddress: string;
  transactionHash: string | null;
  mined: boolean;
  receiptStatus: number | null;
  blockNumber: number | null;
  gasUsed: string | null;
  note: string;
  controlledTest: true;
}

export interface ClaimDocument {
  claimId: string;
  schema: string;
  label: string;
  createdAt: string;
  claimant: { account: string; role: string };
  scope: Record<string, string>;
  exclusivityKey: string;
  evidence: { evidenceId: string; digest: string }[];
  result: { statement: string; value: number | null; unit: string | null; basis: string };
  baseline: string;
  creditable: false;
  verificationState: string;
  supersedes: string | null;
  correctionNote: string | null;
}

export interface ClaimProof {
  claimId: string;
  claimKey: string;
  recorded: boolean;
  status: ClaimStatus;
  chainId: number;
  contractAddress: string;
  exclusivityKey?: string;
  activeForScope?: boolean;
  evidenceId?: string | null;
  claimHash?: string;
  supersedesClaimId?: string | null;
  supersededByClaimId?: string | null;
  challengeReasonHash?: string | null;
  claimant?: string;
  challenger?: string | null;
  submittedBlock?: number;
  transactionHash?: string | null;
  receiptStatus?: number | null;
}

export interface ClaimResponse { claim: ClaimDocument; claimHash: string; proof: ClaimProof }
export interface StoredClaimResponse { claim: ClaimDocument; claimHash: string; proof: ClaimProof | null; chainProblem: ChainProblem | null }
export interface DuplicateResponse extends RejectionResponse { duplicateOf: string; attemptedClaim: ClaimDocument; sameExclusivityKey: boolean }
export interface ChallengeResponse { challenge: { reasonCode: string; detail: string; createdAt: string }; reasonHash: string; transactionHash: string; blockNumber: number; proof: ClaimProof }
export interface ResolveResponse { claimId: string; upheld: boolean; transactionHash: string; blockNumber: number; proof: ClaimProof }
export interface CorrectionResponse {
  originalClaimId: string;
  revisedEvidence: { evidenceId: string; digest: string; bundle: EvidenceBundle; anchorTransactionHash: string; proof: EvidenceProof };
  correctedClaim: { claim: ClaimDocument; claimHash: string; approvalTransactionHash: string; proof: ClaimProof };
  originalClaim: { proof: ClaimProof };
  originalEvidence: { proof: EvidenceProof };
}

export interface ContractInfo { name: string; address: string; deployBlock: number; deployTxHash: string | null }
export interface StatusResponse {
  ledgerMode: LedgerMode;
  network: string;
  chainId: number;
  rpcUrl: string;
  latestBlock?: number;
  contracts?: { evidenceRegistry: ContractInfo; claimRegistry: ContractInfo };
  accounts?: Record<'attester' | 'claimant' | 'reviewer' | 'challenger', string>;
  accountsNote?: string;
  evidenceCount?: number;
  claimCount?: number;
  demoRun?: number;
  problem?: ChainProblem;
  sources: { openMeteo: { status: string; note: string }; openAq: { status: string; note: string } };
}

export interface HistoryEvent { contract: string; event: string; blockNumber: number; logIndex: number; transactionHash: string; details: Record<string, unknown> }
export interface HistoryResponse { events: HistoryEvent[]; timeline: (Record<string, unknown> & { at: string; kind: string })[]; demoRun: number }
export interface SitesResponse { sites: Site[]; analytes: AnalyteDefinition[] }

export class IntegrityApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errorName: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, errorName: string | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'IntegrityApiError';
    this.status = status;
    this.code = code;
    this.errorName = errorName;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const BASE = '/api/v1/integrity';

async function request<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const post = options.method === 'POST';
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: post ? { 'content-type': 'application/json' } : undefined,
      body: post ? JSON.stringify(options.body ?? {}) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new IntegrityApiError(0, 'gateway_unreachable', 'The Climate Chain gateway is not reachable. Start it with start.ps1.');
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; errorName?: string; retryAfterSeconds?: number } } | null)?.error;
    throw new IntegrityApiError(response.status, error?.code ?? 'request_failed', error?.message ?? `Request failed with HTTP ${response.status}.`, error?.errorName ?? null, error?.retryAfterSeconds ?? null);
  }
  return body as T;
}

export interface FirewallRuleResult {
  ruleId: string;
  passed: boolean;
  reason?: string;
  code?: string;
  digest?: string;
  sourceId?: string;
  claimType?: string;
  primaryBasis?: string;
  ageHours?: number;
  lat?: number;
  lon?: number;
  compositeScopeKey?: string;
  requiresHumanReview?: boolean;
  isUnknown?: boolean;
}

export interface FirewallReceipt {
  receiptId: string;
  schema: string;
  firewallVersion: string;
  evaluatedAt: string;
  claimId: string;
  claimType: string;
  evidenceDigest: string | null;
  verdict: 'ACCEPTED' | 'REJECTED' | 'HUMAN_REVIEW_REQUIRED' | 'UNKNOWN';
  passedAllRules: boolean;
  reasons: string[];
  ruleSummary: { total: number; passed: number; failed: number };
  compositeScopeKey: string | null;
  onChainAnchoringEligible: boolean;
  firewallReceiptHash: string;
}

export interface FirewallEvaluationResult {
  verdict: 'ACCEPTED' | 'REJECTED' | 'HUMAN_REVIEW_REQUIRED' | 'UNKNOWN';
  receiptId: string;
  receipt: FirewallReceipt;
  errors: string[];
  ruleResults: FirewallRuleResult[];
  eligibleForOnChainSubmission: boolean;
  scopeKey?: string;
  limitsNotice: string;
}

export interface BenchmarkSystemStats {
  totalCases: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  unsafeAcceptanceRate: number;
  falseRejectionRate: number;
  avgLatencyMs: number;
}

export interface FirewallBenchmarkResponse {
  timestamp: string;
  totalCases: number;
  results: Record<string, BenchmarkSystemStats>;
}

export const integrityApi = {
  status: (signal?: AbortSignal) => request<StatusResponse>('/status', { signal }),
  sites: () => request<SitesResponse>('/sites'),
  history: () => request<HistoryResponse>('/history'),
  buildEvidence: (body: { siteId: string; analyte: string; mode: SourceMode }) => request<EvidenceResponse>('/evidence', { method: 'POST', body }),
  getEvidence: (evidenceId: string) => request<EvidenceResponse>(`/evidence/${evidenceId}`),
  anchor: (evidenceId: string) => request<EvidenceProof>(`/evidence/${evidenceId}/anchor`, { method: 'POST' }),
  verify: (evidenceId: string) => request<VerifyResponse>(`/evidence/${evidenceId}/verify`),
  tamper: (evidenceId: string) => request<TamperResponse>(`/evidence/${evidenceId}/tamper`, { method: 'POST' }),
  replay: (evidenceId: string) => request<RejectionResponse>(`/evidence/${evidenceId}/replay`, { method: 'POST' }),
  submitClaim: (evidenceId: string) => request<ClaimResponse>('/claims', { method: 'POST', body: { evidenceId } }),
  getClaim: (claimId: string) => request<StoredClaimResponse>(`/claims/${claimId}`),
  duplicateClaim: (claimId: string) => request<DuplicateResponse>(`/claims/${claimId}/duplicate`, { method: 'POST' }),
  challenge: (claimId: string, body: { reasonCode: string; detail: string }) => request<ChallengeResponse>(`/claims/${claimId}/challenge`, { method: 'POST', body }),
  resolve: (claimId: string, upheld: boolean) => request<ResolveResponse>(`/claims/${claimId}/resolve`, { method: 'POST', body: { upheld } }),
  correct: (claimId: string, note: string) => request<CorrectionResponse>(`/claims/${claimId}/correct`, { method: 'POST', body: { note } }),
  reset: () => request<{ demoRun: number; note: string }>('/reset', { method: 'POST' }),
  evaluateFirewall: (body: { claim?: unknown; evidence?: unknown; expectedDigest?: string; claimType?: string }) => request<FirewallEvaluationResult>('/firewall/evaluate', { method: 'POST', body }),
  benchmarkFirewall: () => request<FirewallBenchmarkResponse>('/firewall/benchmark'),
  evaluateClaimFirewall: (claimId: string, claimType?: string) => request<FirewallEvaluationResult>(`/claims/${claimId}/firewall`, { method: 'POST', body: { claimType } }),
};
