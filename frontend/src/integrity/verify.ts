// Browser-side verifier for Climate Integrity Lab evidence. It re-hashes the evidence bundle
// with WebCrypto and reads the registry directly over JSON-RPC, so a reviewer does not have
// to trust the gateway's own verification result.
//
// The canonical form must match gateway/integrity-evidence.mjs byte for byte. The shared
// vector in gateway/fixtures/integrity/canonical-vector.json checks that in both test suites.

import { keccakText } from '../modules/carbontwin/domain/keccak';

export const LOCAL_CHAIN_ID = 31337;

export class CanonicalError extends Error {}

// climate-chain-canonical-json/v1: sorted keys (UTF-16 code unit order), no whitespace,
// JSON.stringify for strings, booleans, null and finite numbers. Refuses anything else.
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalError('Canonical JSON cannot encode NaN or Infinity.');
      return JSON.stringify(value);
    case 'object': {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new CanonicalError('Canonical JSON accepts plain objects only.');
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => {
        if (record[key] === undefined) throw new CanonicalError(`Field "${key}" is undefined.`);
        return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
      }).join(',')}}`;
    }
    default:
      throw new CanonicalError(`Canonical JSON cannot encode a ${typeof value}.`);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const digestOf = (value: unknown) => sha256Hex(canonicalJson(value));
export const evidenceKeyOf = (evidenceId: string) => keccakText(evidenceId);
export const selectorOf = (signature: string) => keccakText(signature).slice(0, 10);

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const word = (hex: string, index: number) => hex.slice(2 + index * 64, 2 + (index + 1) * 64);

export interface OnChainEvidence {
  digest: string;
  parentEvidenceId: string;
  metadataHash: string;
  supersededBy: string;
  attester: string;
  blockNumber: number;
  anchoredAt: number;
}

export function encodeBytes32Call(signature: string, ...args: string[]): string {
  for (const arg of args) {
    if (!BYTES32.test(arg)) throw new Error('Each argument must be a 32-byte hex value.');
  }
  return selectorOf(signature) + args.map((arg) => arg.slice(2).toLowerCase()).join('');
}

// getEvidence returns a static struct of seven 32-byte words.
export function decodeEvidence(result: string): OnChainEvidence {
  if (!/^0x[0-9a-fA-F]{448}$/.test(result)) throw new Error('getEvidence returned an unexpected payload.');
  return {
    digest: `0x${word(result, 0)}`,
    parentEvidenceId: `0x${word(result, 1)}`,
    metadataHash: `0x${word(result, 2)}`,
    supersededBy: `0x${word(result, 3)}`,
    attester: `0x${word(result, 4).slice(24)}`,
    blockNumber: Number(BigInt(`0x${word(result, 5)}`)),
    anchoredAt: Number(BigInt(`0x${word(result, 6)}`)),
  };
}

export function decodeBool(result: string): boolean {
  if (!BYTES32.test(result)) throw new Error('Expected a 32-byte boolean result.');
  return BigInt(result) === 1n;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[], fetchImpl: FetchLike = fetch, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}.`);
    const body = await response.json() as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? 'RPC error');
    return body.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface IndependentCheck { id: string; label: string; ok: boolean; detail: string }
export interface IndependentResult { verified: boolean; reachable: boolean; browserDigest: string; checks: IndependentCheck[] }

export async function verifyIndependently({ rpcUrl, contractAddress, evidenceId, bundle, expectedDigest, transactionHash, fetchImpl = fetch }: {
  rpcUrl: string;
  contractAddress: string;
  evidenceId: string;
  bundle: unknown;
  expectedDigest: string;
  transactionHash?: string | null;
  fetchImpl?: FetchLike;
}): Promise<IndependentResult> {
  const browserDigest = await digestOf(bundle);
  const checks: IndependentCheck[] = [
    { id: 'browser-digest', label: 'This browser re-hashed the bundle with SHA-256', ok: browserDigest === expectedDigest.replace(/^0x/, '').toLowerCase(), detail: browserDigest },
  ];
  const call = <T>(method: string, params: unknown[]) => rpcCall<T>(rpcUrl, method, params, fetchImpl);
  try {
    const chainId = Number(BigInt(await call<string>('eth_chainId', [])));
    checks.push({ id: 'chain-id', label: `Chain id is ${LOCAL_CHAIN_ID}, the local Hardhat chain`, ok: chainId === LOCAL_CHAIN_ID, detail: String(chainId) });
    const code = await call<string>('eth_getCode', [contractAddress, 'latest']);
    checks.push({ id: 'contract-code', label: 'Contract code exists at the registry address', ok: typeof code === 'string' && code !== '0x', detail: `${Math.max(0, (code.length - 2) / 2)} bytes` });
    const key = evidenceKeyOf(evidenceId);
    const record = decodeEvidence(await call<string>('eth_call', [{ to: contractAddress, data: encodeBytes32Call('getEvidence(bytes32)', key) }, 'latest']));
    checks.push({ id: 'on-chain-digest', label: 'Digest read from the registry equals the browser digest', ok: record.digest === `0x${browserDigest}`, detail: record.digest });
    const accepted = decodeBool(await call<string>('eth_call', [{ to: contractAddress, data: encodeBytes32Call('verifyDigest(bytes32,bytes32)', key, `0x${browserDigest}`) }, 'latest']));
    checks.push({ id: 'contract-verify', label: 'Contract verifyDigest returns true for the browser digest', ok: accepted, detail: String(accepted) });
    if (transactionHash) {
      const receipt = await call<{ status?: string; to?: string; blockNumber?: string } | null>('eth_getTransactionReceipt', [transactionHash]);
      const ok = Boolean(receipt && receipt.status === '0x1' && receipt.to?.toLowerCase() === contractAddress.toLowerCase());
      checks.push({ id: 'receipt', label: 'Anchoring receipt has status 1 and targets the registry', ok, detail: receipt ? `block ${Number(BigInt(receipt.blockNumber ?? '0x0'))}, status ${receipt.status}` : 'receipt not found' });
    }
    return { verified: checks.every((check) => check.ok), reachable: true, browserDigest, checks };
  } catch (error) {
    checks.push({ id: 'rpc', label: 'Browser reached the chain RPC directly', ok: false, detail: error instanceof Error ? error.message : 'RPC unreachable' });
    return { verified: false, reachable: false, browserDigest, checks };
  }
}

// A command a judge can paste into a terminal to read the same record without this app.
export function curlEvidenceCall(rpcUrl: string, contractAddress: string, evidenceId: string): string {
  const data = encodeBytes32Call('getEvidence(bytes32)', evidenceKeyOf(evidenceId));
  return `curl -s -X POST ${rpcUrl} -H "content-type: application/json" --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"${contractAddress}","data":"${data}"},"latest"]}'`;
}
