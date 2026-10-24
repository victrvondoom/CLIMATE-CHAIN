import { describe, expect, it } from 'vitest';
import vector from '../../../gateway/fixtures/integrity/canonical-vector.json';
import {
  CanonicalError, canonicalJson, curlEvidenceCall, decodeBool, decodeEvidence, digestOf, encodeBytes32Call,
  evidenceKeyOf, selectorOf, sha256Hex, verifyIndependently,
} from './verify';

// Reference values computed with ethers v6 (id, Interface.getFunction().selector, encodeFunctionData)
// against the compiled EnvironmentalEvidenceRegistry ABI.
const EVIDENCE_ID = 'ev-b0e5297e10d363f909d9dc65';
const EVIDENCE_KEY = '0x300a2bb7fccf643c3c6163355ccff910eec9955d591488162b2f606402246e2e';
const CONTRACT = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const TX = `0x${'cd'.repeat(32)}`;

const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');

function encodeRecord(digest: string) {
  return `0x${[digest, '0', 'ab'.repeat(32), '0', 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266', 'd', '6720c5a0'].map(pad).join('')}`;
}

function fakeRpc({ anchoredDigest, receiptStatus = '0x1' }: { anchoredDigest: string; receiptStatus?: string }) {
  return async (_url: string, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: { data?: string }[] };
    let result: unknown = null;
    if (method === 'eth_chainId') result = '0x7a69';
    else if (method === 'eth_getCode') result = '0x6080604052';
    else if (method === 'eth_call') {
      const data = params[0].data ?? '';
      result = data.startsWith(selectorOf('getEvidence(bytes32)'))
        ? encodeRecord(anchoredDigest)
        : `0x${pad(data.slice(10 + 64) === anchoredDigest ? '1' : '0')}`;
    } else if (method === 'eth_getTransactionReceipt') result = { status: receiptStatus, to: CONTRACT.toLowerCase(), blockNumber: '0xd' };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('browser canonical hashing', () => {
  it('reproduces the gateway test vector byte for byte', async () => {
    expect(canonicalJson(vector.input)).toBe(vector.canonical);
    expect(await sha256Hex(vector.canonical)).toBe(vector.sha256);
    expect(await digestOf(vector.input)).toBe(vector.sha256);
  });

  it('refuses values the gateway also refuses', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(CanonicalError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(CanonicalError);
    expect(() => canonicalJson(new Map())).toThrow(CanonicalError);
  });
});

describe('registry call encoding', () => {
  it('derives the same evidence key, selectors and call data as ethers', () => {
    expect(evidenceKeyOf(EVIDENCE_ID)).toBe(EVIDENCE_KEY);
    expect(selectorOf('getEvidence(bytes32)')).toBe('0x4a7221a0');
    expect(selectorOf('verifyDigest(bytes32,bytes32)')).toBe('0xbc2258bc');
    expect(encodeBytes32Call('getEvidence(bytes32)', EVIDENCE_KEY)).toBe(`0x4a7221a0${EVIDENCE_KEY.slice(2)}`);
    expect(() => encodeBytes32Call('getEvidence(bytes32)', '0x1234')).toThrow();
  });

  it('decodes the evidence struct and booleans', () => {
    const record = decodeEvidence(encodeRecord('ee'.repeat(32)));
    expect(record.digest).toBe(`0x${'ee'.repeat(32)}`);
    expect(record.attester).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(record.blockNumber).toBe(13);
    expect(record.anchoredAt).toBe(0x6720c5a0);
    expect(decodeBool(`0x${pad('1')}`)).toBe(true);
    expect(decodeBool(`0x${pad('0')}`)).toBe(false);
    expect(() => decodeEvidence('0x1234')).toThrow();
  });

  it('builds a terminal command that reads the record without this app', () => {
    const command = curlEvidenceCall('http://127.0.0.1:18545', CONTRACT, EVIDENCE_ID);
    expect(command).toContain('eth_call');
    expect(command).toContain(`0x4a7221a0${EVIDENCE_KEY.slice(2)}`);
  });
});

describe('verifyIndependently', () => {
  it('verifies when the browser digest matches the anchored digest and the receipt succeeded', async () => {
    const digest = await digestOf(vector.input);
    const result = await verifyIndependently({ rpcUrl: 'http://127.0.0.1:18545', contractAddress: CONTRACT, evidenceId: EVIDENCE_ID, bundle: vector.input, expectedDigest: digest, transactionHash: TX, fetchImpl: fakeRpc({ anchoredDigest: digest }) });
    expect(result.reachable).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual(['browser-digest', 'chain-id', 'contract-code', 'on-chain-digest', 'contract-verify', 'receipt']);
  });

  it('fails when the bundle was altered after anchoring', async () => {
    const digest = await digestOf(vector.input);
    const altered = { ...vector.input, value: 41.8 };
    const result = await verifyIndependently({ rpcUrl: 'http://127.0.0.1:18545', contractAddress: CONTRACT, evidenceId: EVIDENCE_ID, bundle: altered, expectedDigest: digest, transactionHash: TX, fetchImpl: fakeRpc({ anchoredDigest: digest }) });
    expect(result.verified).toBe(false);
    expect(result.checks.find((check) => check.id === 'on-chain-digest')?.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'contract-verify')?.ok).toBe(false);
  });

  it('fails on a reverted anchoring receipt', async () => {
    const digest = await digestOf(vector.input);
    const result = await verifyIndependently({ rpcUrl: 'http://127.0.0.1:18545', contractAddress: CONTRACT, evidenceId: EVIDENCE_ID, bundle: vector.input, expectedDigest: digest, transactionHash: TX, fetchImpl: fakeRpc({ anchoredDigest: digest, receiptStatus: '0x0' }) });
    expect(result.verified).toBe(false);
    expect(result.checks.find((check) => check.id === 'receipt')?.ok).toBe(false);
  });

  it('reports an unreachable chain as unverified, never as passed', async () => {
    const digest = await digestOf(vector.input);
    const result = await verifyIndependently({ rpcUrl: 'http://127.0.0.1:18545', contractAddress: CONTRACT, evidenceId: EVIDENCE_ID, bundle: vector.input, expectedDigest: digest, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    expect(result.reachable).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)?.id).toBe('rpc');
  });
});
