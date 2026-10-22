// Keccak-256 as Ethereum uses it (original Keccak padding, not NIST SHA3-256), in pure TypeScript.
// The browser has no keccak in WebCrypto, and this module adds no dependency. The Keccak-f[1600]
// permutation is the FIPS 202 round function with 24 rounds on 64-bit lanes indexed x + 5y.

const RC: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets for lane x + 5y.
const ROT: readonly number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const MASK = (1n << 64n) - 1n;

function rotl(x: bigint, n: number): bigint {
  if (n === 0) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;
}

function permute(s: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c: bigint[] = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const d: bigint[] = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
    for (let i = 0; i < 25; i++) s[i] ^= d[i % 5];

    const b: bigint[] = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
      }
    }

    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        s[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & MASK & b[((x + 2) % 5) + 5 * y]);
      }
    }

    s[0] ^= RC[round];
  }
}

const RATE = 136; // bytes absorbed per block for 256-bit output (1088 bits)

export function keccak256(input: Uint8Array): Uint8Array {
  const blocks = Math.floor(input.length / RATE) + 1;
  const padded = new Uint8Array(blocks * RATE);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[blocks * RATE - 1] ^= 0x80;

  const state: bigint[] = new Array<bigint>(25).fill(0n);
  for (let block = 0; block < blocks; block++) {
    for (let lane = 0; lane < RATE / 8; lane++) {
      let value = 0n;
      for (let k = 7; k >= 0; k--) value = (value << 8n) | BigInt(padded[block * RATE + lane * 8 + k]);
      state[lane] ^= value;
    }
    permute(state);
  }

  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane++) {
    for (let k = 0; k < 8; k++) out[lane * 8 + k] = Number((state[lane] >> BigInt(8 * k)) & 0xffn);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function keccakHex(bytes: Uint8Array): string {
  return `0x${toHex(keccak256(bytes))}`;
}

// Hash of the UTF-8 bytes of a string, as keccak256(stringToHex(text)) in viem.
export function keccakText(text: string): string {
  return keccakHex(new TextEncoder().encode(text));
}
