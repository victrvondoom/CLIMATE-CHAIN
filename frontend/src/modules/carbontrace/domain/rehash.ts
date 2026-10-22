// Browser re-hash of an evidence bundle: canonical JSON of the payload, SHA-256, compared with the stored hash.
// Uses the shared core/evidence functions. The source commits keccak256 on-chain; WebCrypto has no keccak256,
// so the stored value for this app is SHA-256 of the same canonical bytes.

import { hashValue } from '../../../core/evidence';

export interface StoredBundle {
  sha256: string;
  payload: unknown;
}

export interface BundleCheck {
  ok: boolean;
  stored: string;
  computed: string;
}

export async function checkBundle(record: StoredBundle): Promise<BundleCheck> {
  const computed = await hashValue(record.payload);
  return { ok: computed === record.sha256, stored: record.sha256, computed };
}
