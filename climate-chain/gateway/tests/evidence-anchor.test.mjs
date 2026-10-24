import test from 'node:test';
import assert from 'node:assert/strict';
import { hashEvidence } from '../cascade.mjs';
import { EvidenceAnchorError, isValidEvidenceDigest, validateCascadeManifest } from '../evidence-anchor.mjs';

function manifest() {
  const payload = {
    schemaVersion: 1,
    id: 'cascade:public-site-17',
    capturedAt: '2026-10-23T11:00:00.000Z',
    evidence: { sources: ['JunkSnap', 'The Vayu Project'], assessment: { status: 'source_not_observed' } },
  };
  return {
    ...payload,
    integrity: {
      algorithm: 'SHA-256',
      digest: hashEvidence(payload),
      scope: 'test manifest',
      limitation: 'test only',
    },
  };
}

test('validates the exact canonical Cascade manifest digest before anchoring', () => {
  const record = manifest();
  const proof = validateCascadeManifest(record);
  assert.equal(proof.digest, `0x${record.integrity.digest}`);
  assert.match(proof.manifestIdHash, /^0x[0-9a-f]{64}$/);
  assert.match(proof.evidenceTypeHash, /^0x[0-9a-f]{64}$/);
  assert.equal(proof.evidenceType, 'climate-chain:cascade-review:v1');
});

test('rejects modified manifest payloads and non-Cascade payloads', () => {
  const changed = manifest();
  changed.evidence.assessment.status = 'ready_for_human_review';
  assert.throws(() => validateCascadeManifest(changed), (error) => error instanceof EvidenceAnchorError && error.code === 'manifest_digest_mismatch');
  assert.throws(() => validateCascadeManifest({ id: 'other:record' }), (error) => error instanceof EvidenceAnchorError && error.code === 'invalid_manifest');
});

test('accepts a 32-byte SHA-256 digest in either API representation', () => {
  assert.equal(isValidEvidenceDigest('b'.repeat(64)), true);
  assert.equal(isValidEvidenceDigest(`0x${'a'.repeat(64)}`), true);
  assert.equal(isValidEvidenceDigest('not-a-digest'), false);
});
