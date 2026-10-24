# Blockchain integrity: what the chain proves, and what it does not

The Climate Integrity Lab turns an environmental signal into an evidence bundle, anchors the bundle's SHA-256 digest on a local EVM chain, and records claims against that evidence so they can be challenged and corrected without erasing history. This page explains the design, the threats it covers, and how to check every result yourself.

## Why a chain here

Environmental evidence and claims fail in three common ways: the numbers behind a claim are edited after the fact, the same evidence or benefit is claimed twice, and corrections overwrite what was originally said. A database row can be changed by whoever runs the database, and nothing outside it records that. On a chain, every write is a signed transaction in a block. Anyone with RPC access can:

- recompute a bundle's SHA-256 and compare it with the digest stored at a known block;
- see that a claim scope already has an active claim in this registry, because the contract refused the second one;
- follow a correction back to the record it replaced, which stays readable.

**Limit of this demo.** It runs on a local Hardhat chain (chain ID 31337) that the operator controls and that `start.ps1` recreates at every start. It shows the mechanism, not public immutability. Public guarantees need a public network, published contract addresses and independent attesters. No mining is involved; Ethereum has used proof of stake since 2022, and the local chain mines a block per transaction automatically.

## What goes on-chain and what stays off-chain

| On-chain (registries) | Off-chain (gateway store, downloadable JSON) |
|---|---|
| keccak256 of the evidence id, SHA-256 digest of the bundle, parent evidence id, SHA-256 of the bundle metadata | The full evidence bundle, the raw provider response, the normalised series |
| Attester address, block number, block timestamp | Source URL, licence, retrieval time, uncertainty and custody notes |
| Claim id, exclusivity key, evidence id, claim document hash, status, supersession links, challenger address and reason hash | The claim document, challenge text and correction note |

No raw measurements, coordinates of people, or personal data are written to the chain. Place coordinates in bundles are public city-centre points.

## Contracts

All three live in [`blockchain/contracts/`](../blockchain/contracts/) and deploy from [`blockchain/scripts/deploy.js`](../blockchain/scripts/deploy.js).

### EvidenceAnchor (existing, unchanged)

Anchors Cascade Review manifest digests. Its behaviour, API and deployment file (`deployments/localhost.json`) are unchanged.

### EnvironmentalEvidenceRegistry

| Function | Who | Effect |
|---|---|---|
| `anchorEvidence(evidenceId, digest, parentEvidenceId, metadataHash)` | attester | Stores a new record. Never overwrites one. |
| `setAttester(account, allowed)` | admin (deployer) | Grants or revokes the attester role |
| `getEvidence`, `exists`, `isCurrent`, `verifyDigest`, `evidenceIdForDigest` | anyone | Reads |

It rejects, with custom errors: an empty id (`EmptyEvidenceId`) or digest (`EmptyDigest`), a reused id (`EvidenceIdTaken`), the same bytes under a new id (`DigestAlreadyAnchored`), an unknown parent (`UnknownParent`), a second correction of the same parent (`ParentAlreadySuperseded`), and non-attesters (`NotAttester`). A correction is a new record whose parent then points forward to it through `supersededBy`, and `EvidenceSuperseded` is emitted.

### ClimateClaimRegistry

```
            submitClaim                challengeClaim (anyone)
  (none) ──────────────► Submitted ─────────────────────────► Challenged
                            ▲                                   │  │
                            │ resolveChallenge(false)           │  │ resolveChallenge(true)
                            └───────────────────────────────────┘  ▼
                                                                Rejected  (scope released)
                     approveCorrection (reviewer)
         Challenged ───────────────────────────► Superseded ──► new claim, same scope, Submitted
```

Two locks stop double counting inside this registry:

- **Exclusivity key**: one active claim per project, boundary, monitoring day, methodology, benefit type and analyte. Evidence ids are deliberately not part of the key, so swapping in different evidence cannot claim the same benefit again (`DuplicateClaim`).
- **Evidence lock**: one evidence record backs at most one active claim (`EvidenceAlreadyClaimed`).

Other rules: claims need anchored, current evidence (`EvidenceNotAnchored`, `EvidenceNotCurrent`); only claimants submit (`NotClaimant`); anyone may challenge with a reason hash (`EmptyReason` otherwise); only a reviewer decides (`NotReviewer`), and never on a claim they submitted (`ConflictOfInterest`). Status changes are checked (`InvalidStatus`). The contract has no transfer, mint, approve or balance functions, and a test enforces that.

**Roles in the demo** are four public Hardhat development accounts: attester `0xf39F…2266`, claimant `0x7099…79C8`, reviewer `0x3C44…93BC`, challenger `0x90F7…b906`. They show separation of duties. They are internal test actors; none is an independent verifier.

Roles are a small custom implementation (admin, attester, claimant, reviewer) rather than OpenZeppelin `AccessControl`, to avoid adding a dependency for three fixed roles. The tests cover every role check.

## Identifiers and hashing

| Value | How it is made |
|---|---|
| Canonical form | `climate-chain-canonical-json/v1`: keys sorted by UTF-16 code unit, no whitespace, `JSON.stringify` for strings, booleans, null and finite numbers. `undefined`, `NaN`, `Infinity` and non-plain objects are refused. Byte-identical to the existing Cascade hash for valid JSON. |
| Bundle digest | SHA-256 of the canonical bundle, including its evidence id |
| Evidence id | `ev-` plus the first 24 hex characters of the SHA-256 of the bundle without its id |
| Metadata hash | SHA-256 of the canonical schema, method, ids, parent, timeframe and source modes |
| On-chain keys | keccak256 of the UTF-8 evidence or claim id (`ethers.id`) |
| Exclusivity key | SHA-256 of the canonical claim scope |
| Raw payload digest | SHA-256 of the exact provider response bytes |

The gateway ([`integrity-evidence.mjs`](../gateway/integrity-evidence.mjs)) and the browser verifier ([`frontend/src/integrity/verify.ts`](../frontend/src/integrity/verify.ts)) are separate implementations. Both test suites check them against the same vector in [`gateway/fixtures/integrity/canonical-vector.json`](../gateway/fixtures/integrity/canonical-vector.json).

## Threat model

| Threat | Control | Status |
|---|---|---|
| Evidence bytes edited after anchoring | Digest recomputed by the gateway and, independently, by the browser; contract `verifyDigest` | Tested: the tamper test changes one value by 0.1 and verification fails |
| Same evidence anchored again | `EvidenceIdTaken`, `DigestAlreadyAnchored` | Tested on-chain: replay mined with status 0 |
| Same benefit claimed twice | Exclusivity key lock | Tested on-chain: `DuplicateClaim`, mined with status 0 |
| One evidence record backing two claims | Evidence lock | Tested in contract tests |
| Correction that forks history | `ParentAlreadySuperseded` | Tested in contract tests |
| Unauthorised writer | Role checks | Tested for every role |
| Reviewer approving their own claim | `ConflictOfInterest` | Tested in contract tests |
| Gateway pointing at a restarted chain | Genesis hash and contract code checked before each call (`deployment_stale`, `contract_missing`) | Implemented |
| Wrong chain or remote RPC | Chain ID 31337 and loopback-only RPC enforced | Implemented |
| Writes from other websites | POST routes require a loopback address and local origin | Tested (403) |
| A receipt drawn by the UI | Every hash and receipt is read back from the node; the browser verifier reads the chain RPC directly | Implemented and checked in a browser |
| Sensor or model wrong before anchoring | Not detectable by hashing. Labels say MODEL FORECAST; the bundle lists what it cannot prove | Not covered by design |
| Operator resets the local chain | Not prevented on a local chain | Not covered: needs a public network |
| Double claims across other registries or chains | Not visible to this contract | Not covered |

## Run and verify

The launcher deploys all three contracts and starts the gateway:

```powershell
.\start.ps1      # then open http://127.0.0.1:8080/#integrity
```

Manually:

```powershell
cd blockchain; npm run node            # terminal 1: chain on 127.0.0.1:18545
cd blockchain; npm run deploy:local    # terminal 2: writes deployments/localhost.json and integrity-localhost.json
cd gateway; node gateway.mjs           # terminal 3
```

Check one evidence record without the app (the lab's **Reproduce from a terminal** panel prints this with real values):

```bash
curl -s -X POST http://127.0.0.1:18545 -H "content-type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"<EnvironmentalEvidenceRegistry>","data":"0x4a7221a0<keccak256(evidence id) without 0x>"},"latest"]}'
# The first 32-byte word of the result is the anchored digest.
curl -s http://127.0.0.1:8080/api/v1/integrity/evidence/<evidence id>/verify
```

Contract tests and the full on-chain path:

```bash
cd blockchain && npx hardhat test
cd gateway && CLIMATE_CHAIN_E2E=1 node --test tests/integrity-e2e.test.mjs   # needs a running node and deployment
```

## Example receipts from a test run

These came from a separate local test chain (RPC port 18546, started 2026-10-23 13:18 UTC, since stopped), run so the launcher's chain on 18545 was not touched. A fresh chain gives the same contract addresses, because Hardhat deploys from the same account and nonces, but different transaction hashes. Verify with your own run rather than trusting these.

| Item | Value |
|---|---|
| EvidenceAnchor | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| EnvironmentalEvidenceRegistry | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` (deploy tx `0xb549fd79…ceac4f60`, block 2) |
| ClimateClaimRegistry | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` (deploy tx `0x0a0f4601…1f4aa587`, block 3) |
| Evidence | `ev-b0e5297e10d363f909d9dc65`, digest `8930058b415d048e885077f84f7492c821fecad08c6a331e96375f9b506db9cc`, live Open-Meteo retrieval at 2026-10-23 13:20 UTC |
| Anchor | tx `0xd9234fe89571e609ff2367dbb096a90915b9d806ff108a05d1bbd1ce0dace5fc`, block 13, status 1, gas 149,535 |
| Replay | `EvidenceIdTaken`, tx `0x062417dd1fcb2fcc5c587edd600117cf2e7c161aa48562c7cf49530216ea3ddf`, block 14, status 0 |
| Claim | `cl-a42ba901a92d3dab33e5a378`, tx `0x3cd239df4b3ca27d07047ff4ab9e0d713d38c48e0d9d8ea99fc93fe764797a74` |
| Duplicate claim | `DuplicateClaim`, tx `0xafbbc4a874b379901afd56c80aa829a2223a86a890759a5ac733bf8e78ceaa94`, block 16, status 0 |
| Challenge | tx `0x908dd93c06d3322372cba30870682e54e1a074b9d0a81c4fd8262d1519418b36`, block 17 |
| Correction | revised evidence `ev-17ad2a0a4e3a21b2f26740b1` (tx `0xeb4d05d1…a2214c`), corrected claim `cl-39e6eb5e285b8296d849f2c0` (tx `0xf0a6f7b2…15328c`); original claim status Superseded |

## Not done

- No testnet deployment. It needs your RPC URL and a funded test key, and was not attempted.
- No independent attesters or external registry lookups.
- No formal security audit.
