// Write-once SHA-256 anchor of each night, ported from flarewatch pipeline/anchor.mjs (the
// on-chain record) and web/app.js (the in-browser check). The anchor is the SHA-256 of the
// day file's raw bytes, so the check reads the exact text, not a re-serialised copy.

import { sha256Hex } from '../../../core/evidence';

export interface AnchorCheck {
  match: boolean;
  computed: string;
  anchored: string;
}

export async function checkAnchor(raw: string, anchored: string): Promise<AnchorCheck> {
  const computed = await sha256Hex(raw);
  return { match: computed === anchored, computed, anchored };
}

export type AnchorAction = 'record' | 'unchanged' | 'mismatch';

// Write-once: the first digest recorded stands. A file whose digest differs is reported as a
// mismatch and never written over the anchor.
export function reconcileAnchor(recorded: string | null, fileDigest: string): AnchorAction {
  if (recorded === null) return 'record';
  return recorded === fileDigest ? 'unchanged' : 'mismatch';
}
