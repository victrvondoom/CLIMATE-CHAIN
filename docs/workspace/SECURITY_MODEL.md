# Security model and trust boundaries

## Boundaries

1. The central gateway binds to IPv4 loopback (`127.0.0.1`) when launched by `gateway.mjs`.
2. Mission routes require a loopback client and a local browser origin. They use bounded JSON input, typed allowlisted tasks, and local user-data persistence.
3. Memory routes enforce their local client/origin policy. Memory MCP is stdio-only and read-only.
4. The normal climate API reflects a CORS origin only for localhost/loopback origins; it does not emit wildcard CORS. Preflight permits GET/HEAD only.
5. The legacy specialist proxy permits GET/HEAD only. It cannot forward writes. Source projects retain action, identity and approval control.
6. Specialist applications are separate systems with their own storage, identities and policies. A central link does not establish shared authorization.

## Memory confidentiality and integrity

The Windows vault and retrieval audit use AES-256-GCM and DPAPI CurrentUser-protected keys. Non-Windows encrypted use requires an externally managed 32-byte key. The active vault and audit fail closed if decryption/authentication fails. Plaintext migration sources are preserved for reversibility and disclosed in the health warning; older plaintext copies require OS file-permission protection and deliberate cleanup policy. Encrypted portable backup uses a separate user passphrase in the browser. Keys and passphrases are not committed or sent to external models by the vault flow.

Hashes provide corruption detection, not signatures. Encryption does not protect against a malicious process running as the same Windows user, local administrator, or an unlocked account. The app has no automatic secret scanner; users review content before saving.

## Agent trust and authorization

Mission task definitions and memory are untrusted input. DAG and task type validation prevent undeclared dependencies and unsupported tools. Supported handlers have no arbitrary shell, file, or network capability. The connector task allows ClearSky's typed aggregate `stats` endpoint or Vayu `today` at a fixed city preset only. Connector and health response bodies are limited to 2 MiB by default (with a bounded configurable ceiling); streamed bodies are stopped when the byte limit is crossed. Execution schema-validates and projects ClearSky to aggregate fields; Vayu persists no exact coordinates, place/station IDs or names, or free-text rationale, and caps samples at 24. Human approval is persisted for tasks explicitly marked as requiring it. Agent memory is subordinate to system/developer/security/repository instructions and required user approval. Evidence records explain the handler and uncertainty; they do not prove an external climate outcome.

## Operational exposure

This is a local development product, not a remotely authenticated service. Loopback binding is the network boundary; there is no multi-user login or remote MCP authentication. Do not expose the gateway through a reverse proxy, tunnel, or container port mapping without adding authentication, authorization, CSRF controls, and a deployment-specific CORS policy. Local processes sharing the OS user can access local files and loopback APIs. Structured diagnostic output should omit transcript text, user tokens, private coordinates, and vault contents.

## Verified controls and remaining tests

The central test suite verifies loopback/origin restrictions, encrypted tamper rejection, wrong-key failure, path/symlink checks, inter-process locking, mission task allowlists, approval, bounded connector response handling, and explicit read-only proxy/CORS behavior. This run did not conduct a penetration test, verify a remote deployment, test malware/local-admin threats, or exercise all twelve failure-injection scenarios from the Genesis request.
