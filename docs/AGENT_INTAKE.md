# Agent intake: one packet

Written for: any agent that submits work to the Climate Chain review desk. You submit one JSON object. The desk checks it, queues it, and a person reviews it. Nothing else is accepted.

## The shape

```json
{
  "schema": "climate-chain.packet/1",
  "module": "flarewatch",
  "stage": "verify",
  "claim": "Two sites in the 15 Oct night file meet the three-of-seven-nights rule.",
  "mode": "RESEARCH",
  "evidence": {
    "kind": "night-summary",
    "payload": { "day": "2026-10-15", "detections": 3, "sites": 2 },
    "sha256": "<sha256 of the canonical payload, 64 hex characters>"
  }
}
```

Exact fields only. An extra field or a missing field is refused.

## Rules

| Field | Rule |
|---|---|
| `schema` | Exactly `climate-chain.packet/1`. |
| `module` | One of the module ids below. |
| `stage` | One of `sense`, `verify`, `act`, `finance`, `prove`, and a stage that module has. |
| `claim` | One sentence, 1 to 280 characters, no control characters. |
| `mode` | `SIMULATED`, `RESEARCH` or `DEMO`. Agents never submit `LIVE`. |
| `evidence.kind` | Lowercase letters, digits and hyphens, at most 40 characters. |
| `evidence.payload` | JSON, at most 64 KB once canonical. |
| `evidence.sha256` | The SHA-256 of the canonical payload, lowercase hex. |

## The canonical hash

The digest is taken over the payload, not the whole packet. The canonical form has keys sorted at every level, no whitespace, and UTF-8 text. The desk recomputes it and refuses the packet on a mismatch.

JavaScript:

```js
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  : v;
const canonical = (value) => JSON.stringify(sortKeys(value));
const sha256 = async (payload) => [...new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(canonical(payload))))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
```

Python:

```python
import hashlib, json
def sha256_of(payload):
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
```

Use integers, or floats that are not whole numbers. JavaScript and Python format whole-number floats differently (`1.0` against `1`), so a payload with `1.0` will not match.

## Module ids

`junksnap`, `clearsky`, `teesri`, `vayu`, `aquaquest`, `climateproof`, `carbonlens`, `carbonshield`, `carbontwin`, `hourmatch`, `plotlock`, `rantai`, `ecograph`, `grounded`, `carbontrace`, `plume`, `flarewatch`, `gridproof`.

The desk shows which stages each module has, and refuses a packet for a stage the module does not have.

## What happens next

1. The packet is checked. Every problem is listed, so one correction pass is enough.
2. A valid packet is queued under the hash of its contents. Submitting the same packet twice does nothing.
3. A reviewer narrows the desk from stage to module to packet, then accepts, holds or rejects it.
4. The verdict is written to the shared evidence ledger with the packet's evidence digest, so the decision can be checked later.

The desk's **Load example** button fills in a valid packet with a correct digest.
