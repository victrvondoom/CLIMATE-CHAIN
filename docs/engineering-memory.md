# Climate Chain engineering memory

Climate Chain includes a local engineering memory vault for human-authored coding guidance. It sits beside the climate workspace as its own user-data sandbox and does not use climate evidence stores or upstream APIs.

## Local storage

The gateway stores `memory-vault.json` under the current OS user's application data directory:

- Windows: `%LOCALAPPDATA%\ClimateChain\AgentMemorySandbox`
- macOS/Linux: `$XDG_DATA_HOME/climate-chain/agent-memory-sandbox`, or `~/.local/share/climate-chain/agent-memory-sandbox`

Set `CLIMATE_CHAIN_MEMORY_DIR` to choose a different local directory outside the project source tree. Keep this directory private to the current OS user and include it in the user's local backup policy. Writes use a temporary file and atomic rename. A sibling initialization marker makes an unexpectedly missing vault fail closed instead of appearing as a new empty memory. Each record has a SHA-256 digest. The complete active recall set has a manifest digest, and a separate whole-vault digest also covers archived records. Malformed or altered data closes recall; it is never silently replaced with an empty vault. The local folder is separate from project source and climate evidence, but it is not an encrypted disk or an OS-level VM/container boundary.

## Capture and review

Use **AI engineering memory** in the app to dictate or type a judgment. Browser speech recognition is browser-managed and can have its own processing behavior; the Climate Chain gateway receives no audio. Transcript text stays in the page until the user copies it into a reviewed judgment and selects **Save to local memory**. New records are active in MCP recall. Editing refreshes their digest. Archiving keeps a local record while excluding it from agent recall. Delete permanently removes a record from the vault.

The vault allows at most 500 records. Each save is serialized with other writes so parallel requests cannot overwrite one another. A complete GET returns all records and the manifest hash; an integrity or disk error returns `CLIMATE_CHAIN_MEMORY_UNAVAILABLE` and a stop-work instruction.

## MCP setup

Run the zero-dependency stdio server with:

```powershell
node gateway/memory-mcp.mjs
```

The app exports an MCP JSON file with the current Node executable and absolute path to this server. Add it to each coding agent's MCP configuration, restart that agent, and install the exported `AGENTS.md` in its project rules. The read-only MCP tools are:

- `climate_chain_memory_recall`: all active judgments, complete-scan status, timestamp, and manifest SHA-256. The active manifest is SHA-256 over UTF-8 record digests in returned vault order, joined with one newline, so clients can reproduce the recall receipt.
- `climate_chain_memory_rules`: current stop-work instructions plus the active judgments.

The MCP initialize instructions and exported rules require recall before code work and require agents to stop if the vault is unavailable, incomplete, or fails its digest check. The app also keeps a gate banner visible on every route. It cannot force a third-party or unconfigured coding agent to load or obey its rules; install both exports and check that the agent reports the manifest digest before relying on the gate.

## Local API

- `GET /api/agent-memory` — full snapshot and completeness metadata.
- `GET /api/agent-memory/exports` — current rules and MCP configuration.
- `POST /api/agent-memory` — create one user-reviewed record.
- `PUT /api/agent-memory/:id` — edit or archive/restore one record.
- `DELETE /api/agent-memory/:id` — permanently remove one record.

Memory API requests require a loopback client and local browser origin. The gateway's existing climate routes retain their original network behavior; the memory API itself rejects non-loopback clients and non-local browser origins.
