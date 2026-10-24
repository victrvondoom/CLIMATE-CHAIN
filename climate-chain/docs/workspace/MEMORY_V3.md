# Engineering Memory — current encrypted local vault

## Storage and migration

The vault remains a versioned JSON store outside project source, not SQLite. Windows default: `%LOCALAPPDATA%\ClimateChain\AgentMemorySandbox`; override: `CLIMATE_CHAIN_MEMORY_DIR` (must remain outside the application source tree). The current implementation keeps the existing `Node >=20` support boundary and uses cross-process file locking plus validated, checksummed, atomic whole-store commits for the bounded local vault (up to 500 records). The built-in `node:sqlite` is only available on newer Node releases and is experimental in the verified runtime; adding it directly would narrow runtime compatibility. This file-backed approach provides single-vault atomic replacement but is not a relational database or multi-user transaction service. A driver-backed SQLite migration remains a separate improvement. The current memory schema migrations and review workflow preserve pre-existing records. Before a nonempty plaintext vault is migrated, its original bytes remain available as a plaintext migration copy; migration does not silently delete the source.

The active encrypted envelope uses AES-256-GCM with authenticated metadata. On Windows, the random data key is protected using DPAPI `CurrentUser`; encrypted backups are made automatically and key rotation preserves old key versions for backup recovery. Rotation is a reviewed UI action. If key material is missing or authentication fails, reads fail closed. The bounded retrieval audit is now stored in `retrieval-audit.enc.json` with the same authenticated encryption when the vault encryption provider is active. A pre-existing `retrieval-audit.jsonl` is preserved as a plaintext recovery copy during its first encrypted append and is called out in the health warning. Corrupt ciphertext never falls back to that old copy. The local file lock, atomic replacement, checksums, bounded records/backups, import validation, and corruption quarantine remain part of the store path.

On non-Windows systems, encryption is available only with a user-managed canonical 32-byte base64 key in `CLIMATE_CHAIN_MEMORY_KEY`; otherwise automatic mode is not encrypted. `CLIMATE_CHAIN_MEMORY_ENCRYPTION=required` makes unavailable encryption a hard error. Do not place the key in a repository or adjacent plaintext file. External-key rotation remains user-managed.

Portable memory backups can be encrypted client-side using PBKDF2-SHA-256 (600,000 iterations) and AES-256-GCM. The passphrase is not sent to the gateway and cannot be recovered by the application. Treat plaintext export formats as sensitive.

## Judgment graph and retrieval

Records retain namespace, reviewed instruction, original transcript, rationale, technical context, confidence, priority, verification state, constraints, affected components, code references, evidence, exceptions, dependencies, conflicts, supersession links and revisions. Recall is deterministic lexical ranking plus declared graph expansion, scoped to global and selected-project memory. Retrieval traces store IDs, reasons, timing, manifest digest, and a query digest rather than raw query text; when encryption is enabled, this metadata is also encrypted at rest. An existing plaintext audit log is preserved and copied into the encrypted audit on the next append. The UI reports an active plaintext vault/audit separately from a retained legacy copy.

There is no semantic embedding or paraphrase retrieval. Conflict inspection surfaces declared conflicts; it cannot infer every contradiction. Retrieval is context, not policy authority. Exported agent rules place system/developer/security/repository policy and human authorization above saved memory. Transcripts, imported records, and evidence remain untrusted data.

## Agent access and readiness

MCP is local stdio and read-only, preserving legacy recall names and adding search, decision, constraint, relation, integrity, conflict and trace reads. Create/update/archive/delete remain reviewed application operations. Generated MCP configuration and rule exports require installation in each agent and restart. The app's mission readiness gate can block its own supported local workflow; it cannot force an external agent to install or obey MCP.

Voice capture is an editable browser transcript followed by human review. Browser speech recognition may process audio through the browser/provider; the application itself sends no microphone audio to its gateway. The UI requires an explicit content review before save. This is a human safeguard, not automatic secret detection.

## Security limits

Encryption at rest protects vault content from casual/offline file inspection when the key is not available. DPAPI CurrentUser is bound to the Windows user context; it does not protect against malware or a process already running as that user. Metadata, file sizes/timestamps, and presence of backups may remain visible. A local administrator or compromised process is outside the same-user application boundary. Checksums detect damage but do not authenticate an attacker who can replace files and recompute them. The JSON store is not a multi-user database.

Do not infer that the user's regular vault is empty from an isolated test. Tests used separate temporary directories and did not inspect or replace the normal vault.
