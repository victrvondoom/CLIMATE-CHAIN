# Architecture decisions

Status: incremental, local-first integration. These decisions preserve each specialist project's data and authorization boundary.

## A. Keep a central modular shell

Climate Chain remains the command center and gateway. Specialist projects keep their native routes, databases, accounts, policy and write actions. The gateway is a modular monolith and source-specific adapter host; no microservice split or cross-project code copy is justified yet.

## B. Use read-only adapters by default

Each adapter owns one upstream's URL, timeout, response validation, normalization, provenance and privacy policy. The four existing adapters are DumpWatch, AshAlert, TapAlert and AirPulse. Existing passthrough routes preserve the source method and forwarded user authorization; specialist services still decide which actions the credential may perform. TapAlert's state route is reduced to aggregate counts before it reaches the central client. The new Cascade route is GET-only and only calls the public DumpWatch site list and AirPulse Today endpoint. It never submits reports, closes cases, sends alerts, moves funds, issues/frees credits or mutates a registry.

## C. Canonical observation envelope (version 1)

The first executable cross-domain envelope is defined in gateway/cascade.mjs. It carries:

- schemaVersion and stable source reference;
- source name and source response URL;
- source mode and observation time;
- public location plus its stated precision;
- value and unit where present;
- AirPulse station identity, distance, age, fetch/as-of metadata;
- assessment status, configurable thresholds, failed/unknown checks and a plain-language explanation.

Observation time is kept separate from source fetch time, API as-of time and the gateway capture time. Missing or invalid values remain null and cannot pass an eligibility check. The current envelope is intentionally specific to DumpWatch and AirPulse; it is not yet a platform-wide persistence schema.

## D. Cascade semantics

The current thin vertical slice is: open DumpWatch site -> AirPulse query at its public coordinate -> source/time/distance checks -> reviewer-facing evidence -> exportable manifest -> handoff to DumpWatch.

The default rule is 5 km and 24 hours; the UI offers bounded choices and the API enforces a maximum of 50 km and 168 hours. These are operational review thresholds, not validated health, pollution, legal or causal thresholds. A passing candidate means only that recent reported observations satisfy the selected proximity checks.

AirPulse's Today response reports the nearest monitor distance from a rounded query point, but not that monitor's exact coordinate. The globe marks the query place, not the monitor. Household coordinates remain off the map.

## E. Evidence integrity

The gateway makes deterministic canonical JSON and SHA-256 for an exported evidence envelope. This detects a changed file when compared with its digest. It does not establish who captured the data, prevent an actor from replacing both content and digest, provide trusted time, or create immutable storage. A signed/append-only audit service requires an identity, authorization and retention design first.

## F. Human decisions and local workflow

There is no central account or authorized reviewer model yet. The current page is read-only. It provides evidence and a source handoff but does not record a canonical review decision or intervention outcome. Do not add central write APIs until authentication, roles, consent, privacy, storage and audit retention are designed and tested.

## G. 3D lens

The overview remains a schematic globe with live or mock source badges. Pilot arcs are explicitly decorative. The evidence review can hide those arcs and show only public site points and the rounded AirPulse query point; it does not invent station coordinates or imply that a line is causal.

## H. Code and data rights

No specialist implementation was copied. Adapters consume HTTP response contracts. Keep licenses and dataset terms attached to future imports: DumpWatch AGPL-3.0; MIT licenses in several projects; UniqueCredit registry source CC BY 4.0; MethaneMend Carbon Mapper attribution; unresolved rights for SinkGuard and Grounded.
