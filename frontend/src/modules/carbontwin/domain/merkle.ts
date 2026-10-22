// Leaf hashing and the sorted-pair Merkle root from contracts/leaf.mjs and contracts/chain.mjs.
// The leaf is keccak256 of abi.encode(string id, bytes32 keccak(a), bytes32 keccak(b),
// uint16[] overlap_vintages, uint256 overlap_volume, string verdict).
import { fromHex, keccakHex, keccakText } from './keccak';

export interface FindingInput {
  id: string;
  a: string;
  b: string;
  overlap_vintages: readonly number[];
  overlap_volume: number;
  verdict: string;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function word(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// ABI tail for a dynamic bytes value: length word, then the data right-padded to 32 bytes.
function dynamicBytes(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(data.length / 32) * 32);
  padded.set(data);
  return concat([word(BigInt(data.length)), padded]);
}

// ABI tail for uint16[]: length word, then each element as one word.
function uint16Array(values: readonly number[]): Uint8Array {
  return concat([word(BigInt(values.length)), ...values.map((v) => word(BigInt(v)))]);
}

export function encodeLeaf(f: FindingInput): Uint8Array {
  const id = dynamicBytes(utf8(f.id));
  const vintages = uint16Array(f.overlap_vintages);
  const verdict = dynamicBytes(utf8(f.verdict));
  const headSize = 6 * 32;
  const offsetId = headSize;
  const offsetVintages = offsetId + id.length;
  const offsetVerdict = offsetVintages + vintages.length;
  return concat([
    word(BigInt(offsetId)),
    fromHex(keccakText(f.a)),
    fromHex(keccakText(f.b)),
    word(BigInt(offsetVintages)),
    // Python int() truncates toward zero, as screen and report code do for overlap_volume.
    word(BigInt(Math.trunc(f.overlap_volume))),
    word(BigInt(offsetVerdict)),
    id,
    vintages,
    verdict,
  ]);
}

export function leafOf(f: FindingInput): string {
  return keccakHex(encodeLeaf(f));
}

// Sorted-pair hash: the smaller 32-byte value always comes first.
export function hashPair(a: string, b: string): string {
  return a < b ? keccakHex(concat([fromHex(a), fromHex(b)])) : keccakHex(concat([fromHex(b), fromHex(a)]));
}

// Fold a proof as CreditClaimRegistry.verifyFinding does.
export function rootFromProof(leaf: string, proof: readonly string[]): string {
  return proof.reduce((h, p) => hashPair(h, p), leaf);
}

export interface MerkleTree {
  root: string;
  proof: (index: number) => string[];
}

// Build a tree the way chain.mjs does: an odd node is carried up unchanged.
export function buildMerkle(leaves: readonly string[]): MerkleTree {
  if (leaves.length === 0) throw new Error('a Merkle tree needs at least one leaf');
  const layers: string[][] = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return {
    root: layers[layers.length - 1][0],
    proof: (index: number) => {
      const out: string[] = [];
      let i = index;
      for (let level = 0; level < layers.length - 1; level++) {
        const sibling = i ^ 1;
        if (sibling < layers[level].length) out.push(layers[level][sibling]);
        i >>= 1;
      }
      return out;
    },
  };
}
