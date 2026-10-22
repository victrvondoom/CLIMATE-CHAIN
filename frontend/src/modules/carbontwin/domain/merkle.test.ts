// Vectors from web/public/data/findings.json: the published findings, their leaves and proofs,
// and the anchored report root. Generated from that file, not edited by hand.
import { describe, expect, it } from 'vitest';
import { keccakText } from './keccak';
import { buildMerkle, leafOf, rootFromProof } from './merkle';

const ROOT = "0xa1f9d37881368afcbcfd10f00fb57de493d8c02a356fde7f71ca5c9b75277e26";

// The 61 published leaves, in findings.json order.
const LEAVES: string[] = [
  "0xb5cd512a1157790b33c60be58bb6e0770da58d954d0c47fa0634eebf22533632",
  "0x6b46ae4f752607537365cfe0b57e697b9f1487d9e80d53ca63a08b5b2ee52753",
  "0x5e7278fee5b55e6cb61e29ba5fc96b7f7e74cc325b1653113c81b0b1e1baa200",
  "0x8372778bba1f8390056bf45ea9f206c7172ce03617eaf4e35f35098d358baef2",
  "0x722b7bd7cc9145844dbf2a39e0350ca404caef33e4275940901b34863df6078a",
  "0x51d473bf70f7564b506262a37606ab9bcdfabaf142663ec6fc93dcd37f9ef3e0",
  "0xcbcc783cc07a2d60a61f6ce63a5e11f16fe08dec59645a8bb81f44a2648affc9",
  "0xcdd7afc570a6e408c4e7629e9acad8f82dede28eb8cc1dfb6f309041c3030093",
  "0x95d0fe3608c8962fc0df7015e39a86db4b3e25ab83c56c5b2a31c6f15536487d",
  "0xb972d2c48357d3d031cee6dd09bf0398383e565d8ce069890fbe0961521cef39",
  "0x3d6437520fa3c88c176c1f6743e7adfaa51fefdf810db83a7746338da9a306dd",
  "0x807fa5c364820a89cd231229c4cf8d525ab1f77fd81a5846604a28d29d61ff1f",
  "0x859abd8e655e1efb27642b5002095df89bbdf24316f4ecfd448f66fce1681393",
  "0x8138d10bfec5651be2d1eeee5a50251bbfb2412b4840ece8a1d50ca634553ef1",
  "0xb302eb7580d39de263042b18660b8a39b124f2e3c2cb885a093f9e3d47228965",
  "0xf4387d63f837a2ab93cbaf9b83b05db89dbc714f4539b71b901ffc633adcec43",
  "0x66afab47ccd6ce7de208814072d4dadb977c051638b11c9d975b8a8346286e8d",
  "0x576f5fe588548942033c3e31f2fe69ce644e3a1031f051c4ac2f2a022b0fb434",
  "0x21cc7818e9a7e6754035edddb8f8b8710aa82a4e9a6ad3886cf9ded3e5a7a56a",
  "0x9ac390b96bf40c84bdda2e89ab2499c4853ea8365d56a686a9e88acd4d2fc855",
  "0x61bb9033e120d9204ca78d992d7222f9f2507ada97a15bd7ae909c95bf5159a8",
  "0x8d6370fe8794732696023b871bafba70733058649fa0f047f6385be0053cda07",
  "0xaa20a50b154ae9be3cd49784dd4b5a6e00a7d91e70bdba1ba80806776a784055",
  "0xb47e56982866ea6003d7ca43fca60feb9827f8432e244863bfb7d65cfd2c042d",
  "0x35a36cd2dcd472ede1aebf730203ea2cd4ad0ceb27cb20d4836c93a14995b797",
  "0xf0482e1229cb8baab00d6abe997619465ec8b5efbb38fa1988b1b6b3163ffef2",
  "0x6a02fd5906c91edd50358ae293d29f09755875c2d016af8e7d03875e78bd641b",
  "0x8679d5e16c27751e8703fc561cda35d38f44a899bd4f74c96850ae70fd5f7482",
  "0x475b8330b7cc9ab60202a8c90f5ac3b32f5ee05233348d5e42e354715f0e322c",
  "0xea60c3d2cb881d1ded31d718261ad4dac84e758cd2b6e7fb66259dc097b80cf0",
  "0xfb7a07897f55f90ca119bfca78cf8966d15b3875ee07690b8fe9fc15f839bf9e",
  "0xc90bc394f0bc323ce0bcd9f050c4a8aa2c0a3054438e641d0408cb9f37188930",
  "0x8e737ba4379ce6398d1f6b3b23d0d12362310541ac222977536f0c47a8cb5834",
  "0x3cf1a30e2ccf286206f6a86d4c282a7434c47c0713e12e1a2f174679c2a51b1d",
  "0xa801d2ec673b26b1e3b2c810ad017774160c22f8ceb625d044fa770a803d7677",
  "0x8a86ba52438d9698df35330f83f5287b20751cc6bdc1cd6cdae80f49382bb1f4",
  "0x974de1cc6054cfa7124381772dd2cdd1532bef525ae5403d67a160fa75807042",
  "0x2dff03fcc6125fcce790b71bf5e0dca9ed61f8817b2fd61e5483505ec000bbf1",
  "0x72974009f80051396e73a45353e095d4bed3c2445230de4c1233de0263ee76a1",
  "0x8a059d46e72832761caaba22e5dd6386d1ef8fd31b174177bbe967ce76c1304c",
  "0x5c16799418b2e81377f46b939e4f37936b685407b8e450a3f7c3821ad2fdf84f",
  "0x39fa567cd2fb3a9618967fc57bc011ff19df090c758d5b665c429ee46773f16d",
  "0xd72736b5bfd26c759c0507df182b83072d4f9e5c76d4ea461d7bd325de7f7fd2",
  "0x1666b7ca34d6e3adf75ecf1570ce66c4e448739999029395f214a476c0dcab98",
  "0x410d13556a45ea9838a67d622f9a6561166b9a6807f48ced502e9a444e04c90b",
  "0x2ae987dccbcfdf3fe5d3ff0790825f3e8ba94ebff3dfb2ef1ef64db213ebd33e",
  "0x5a06f7bcaae2386887b5aed68ad815d8b5ce2fa4154307bbbcb39ba0453f2ce5",
  "0x76529c63a9bf9d93f3355c3144e649aa8f4571bb3f2e6596a09645a1fcb369f6",
  "0xb95a26b178a828773babb59801592db97e855a98d2fc07fe320daa85c07ef442",
  "0xf7ba638c5a395a203ace5e20d1766fc135ac050ad888b73147e5b55201e75a5d",
  "0xf707593f8e17bce028df36caaa03f18edb9883d9949faa7533c77e953f526b1a",
  "0x645d9d4f75ec1dc8710092e213adbd5b7cf7146a4e09ff9d3bf10b1f878f8f0e",
  "0x317b24b0d4239ce74cae33f51792cf785da1718c9461ae885449e1b426fd2742",
  "0xe73a205bf0fc0bcef4a01993b87a772e1cf6429fca12758abea08b1b9e981cce",
  "0x38f086ee85d92fc31528f6a3b58758144592fe9b077684f7c9aa7115a6ae2bcb",
  "0xad576ddfb446626bc32ba6beba7c9bfc29e60aba821e99a1752d44767e5e8ff3",
  "0x8b2c9caec7bfb73a12f1b40831823820a5ca4c186bff3ae5c8c254994c5ce9f6",
  "0xfd8f02e430737e2d048a68c5cee35f5a8f07cb48bd853b7ea3fc73d7c1c95cb5",
  "0x85bbb642ac7c204bd17c272bbe871f06f271cf3325e48cbc8fb1ca535f4d1a26",
  "0x1e3595f20778057611d1dd884e9b549a61d27548bed1daf950c379414747f18a",
  "0xf14a6abdd6afa07f2293f566a8a239e82ef2bfadac8157322204571eaa8489e3"
];

// Three published findings: 3 overlapping vintages, 1, and none.
const FINDINGS = [
  {"id": "GS7538~VCS1931", "a": "GS7538", "b": "VCS1931", "overlap_vintages": [2019, 2020, 2021], "overlap_volume": 1812874, "verdict": "yes", "leaf": "0xb5cd512a1157790b33c60be58bb6e0770da58d954d0c47fa0634eebf22533632", "proof": ["0x6b46ae4f752607537365cfe0b57e697b9f1487d9e80d53ca63a08b5b2ee52753", "0x625c3e0437f5b4fa4d0ebdeaad4f0b98266317576bf09040e19c86a3d96d4180", "0xe7aa491e5c9116fcddc5057e199b9ffd7a609a810c28ed2f083f9518d8ba5abc", "0xa76977f2ee085b4f14ec73524d3446ee9177c3ecccf555d5912ac2f1f876932d", "0xd09064513da286d60121806e5b4afbc8a78acb525f8e2412451279c6808a1884", "0x5b9ccb750fb45c8ba42f45af2592f5656edc8e56e2aca0608a56c935d485b546"]},
  {"id": "GS513~VCS135", "a": "GS513", "b": "VCS135", "overlap_vintages": [2008], "overlap_volume": 70908, "verdict": "yes", "leaf": "0x722b7bd7cc9145844dbf2a39e0350ca404caef33e4275940901b34863df6078a", "proof": ["0x51d473bf70f7564b506262a37606ab9bcdfabaf142663ec6fc93dcd37f9ef3e0", "0xe7e129b951d390f4dc3f764d54ba1fd4224e5053c631d96a86aea618da54b811", "0x559363f150dace2ae41803adfe57d6530795ccb60f9c7583fb2439bd295923d5", "0xa76977f2ee085b4f14ec73524d3446ee9177c3ecccf555d5912ac2f1f876932d", "0xd09064513da286d60121806e5b4afbc8a78acb525f8e2412451279c6808a1884", "0x5b9ccb750fb45c8ba42f45af2592f5656edc8e56e2aca0608a56c935d485b546"]},
  {"id": "ACR0258~CAR992", "a": "ACR0258", "b": "CAR992", "overlap_vintages": [], "overlap_volume": 0, "verdict": "yes", "leaf": "0x21cc7818e9a7e6754035edddb8f8b8710aa82a4e9a6ad3886cf9ded3e5a7a56a", "proof": ["0x9ac390b96bf40c84bdda2e89ab2499c4853ea8365d56a686a9e88acd4d2fc855", "0x686ab401b446b6fad97497be4cd93bfb3c9eb4f6ac082875600daaf38f696abe", "0x5aff1e9f34bb4ad266f111684189579ebff6f22b0f18fbb32eefdf5e5e057a81", "0x2161bf4b3394e4f423e1bd8bf659c88a76b48bd430c3ad04a9bf87b4ff7eed69", "0xa701f5d9cc00fa91a8ee09aab687e0a1cf0cd4997188d40a2afe672883a694cc", "0x5b9ccb750fb45c8ba42f45af2592f5656edc8e56e2aca0608a56c935d485b546"]},
];

describe('keccak-256', () => {
  it('matches the Keccak-256 test vector for the empty string', () => {
    expect(keccakText('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });
});

describe('leaf encoding (contracts/leaf.mjs)', () => {
  it('reproduces the published leaf of each sample finding', () => {
    for (const f of FINDINGS) expect(leafOf(f)).toBe(f.leaf);
  });

  it('changes the leaf when the verdict changes', () => {
    expect(leafOf({ ...FINDINGS[0], verdict: 'no' })).not.toBe(FINDINGS[0].leaf);
  });
});

describe('sorted-pair Merkle root (contracts/chain.mjs, CreditClaimRegistry.verifyFinding)', () => {
  it('rebuilds the anchored root from the 61 published leaves', () => {
    expect(buildMerkle(LEAVES).root).toBe(ROOT);
  });

  it('reproduces the published proof for the first and the no-overlap findings', () => {
    const tree = buildMerkle(LEAVES);
    expect(LEAVES[0]).toBe(FINDINGS[0].leaf);
    expect(tree.proof(0)).toEqual(FINDINGS[0].proof);
    expect(LEAVES[18]).toBe(FINDINGS[2].leaf);
    expect(tree.proof(18)).toEqual(FINDINGS[2].proof);
  });

  it('folds each published proof into the anchored root', () => {
    for (const f of FINDINGS) expect(rootFromProof(f.leaf, f.proof)).toBe(ROOT);
  });

  it('rejects a forged leaf that carries a genuine proof', () => {
    expect(rootFromProof(keccakText('forged'), FINDINGS[0].proof)).not.toBe(ROOT);
  });
});
