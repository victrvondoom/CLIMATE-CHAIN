import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createMemoryRecord, exportMemoryBackup, getMemoryRetrievalTrace, importMemoryBackup, listMemoryBackups, readMemorySnapshot, searchMemoryRecords } from '../agent-memory.mjs';

const payload = {
  title: 'Encrypt scoped memory',
  rule: 'Keep authenticated memory in the isolated user vault.',
  why: 'Engineering judgments can be sensitive.',
  scope: 'project',
  project: 'climate-chain',
  category: 'boundary',
  tags: ['security'],
  source: 'typed',
  technicalContext: 'AES-256-GCM payload encryption.',
  evidence: ['test:memory-v3'],
};

async function inVault(t, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-memory-v3-'));
  const previous = {
    directory: process.env.CLIMATE_CHAIN_MEMORY_DIR,
    encryption: process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION,
    key: process.env.CLIMATE_CHAIN_MEMORY_KEY,
  };
  process.env.CLIMATE_CHAIN_MEMORY_DIR = directory;
  process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION = 'required';
  process.env.CLIMATE_CHAIN_MEMORY_KEY = Buffer.alloc(32, 19).toString('base64');
  t.after(async () => {
    if (previous.directory === undefined) delete process.env.CLIMATE_CHAIN_MEMORY_DIR;
    else process.env.CLIMATE_CHAIN_MEMORY_DIR = previous.directory;
    if (previous.encryption === undefined) delete process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION;
    else process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION = previous.encryption;
    if (previous.key === undefined) delete process.env.CLIMATE_CHAIN_MEMORY_KEY;
    else process.env.CLIMATE_CHAIN_MEMORY_KEY = previous.key;
    await rm(directory, { recursive: true, force: true });
    await rm(directory + '.initialized', { force: true });
  });
  await run(directory);
}

test('new vault uses authenticated encryption, survives a new process, and encrypts automatic backups', async (t) => {
  await inVault(t, async (directory) => {
    await createMemoryRecord(payload);
    const vaultPath = path.join(directory, 'memory-vault.enc.json');
    const stored = await readFile(vaultPath, 'utf8');
    assert.equal(stored.includes(payload.rule), false);
    const snapshot = await readMemorySnapshot();
    assert.equal(snapshot.entries[0].rule, payload.rule);
    assert.equal(snapshot.encryption.enabled, true);
    assert.equal(snapshot.encryption.algorithm, 'AES-256-GCM');
    assert.equal(snapshot.encryption.auditEncryptedAtRest, true);
    assert.equal(snapshot.encryption.legacyPlaintextCopy, false);

    const backup = await exportMemoryBackup();
    await importMemoryBackup(backup, { reviewed: true, confirmation: 'REPLACE_LOCAL_MEMORY' });
    const backups = await listMemoryBackups();
    assert.equal(backups.backups.length, 1);
    assert.equal(backups.backups[0].encryptedAtRest, true);
    const backupText = await readFile(path.join(directory, 'backups', backups.backups[0].name), 'utf8');
    assert.equal(backupText.includes(payload.rule), false);

    const childScript = `import { readMemorySnapshot } from ${JSON.stringify(new URL('../agent-memory.mjs', import.meta.url).href)}; const s = await readMemorySnapshot(); process.stdout.write(JSON.stringify({count:s.count, rule:s.entries[0]?.rule, encrypted:s.encryption.enabled}));`;
    const child = await new Promise((resolve, reject) => {
      const processChild = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
        env: { ...process.env, CLIMATE_CHAIN_MEMORY_DIR: directory },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      processChild.stdout.on('data', (part) => { stdout += part.toString(); });
      processChild.stderr.on('data', (part) => { stderr += part.toString(); });
      processChild.on('error', reject);
      processChild.on('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    });
    assert.deepEqual(JSON.parse(child), { count: 1, rule: payload.rule, encrypted: true });
  });
});

test('plaintext migration preserves original bytes while creating an encrypted active vault', async (t) => {
  await inVault(t, async (directory) => {
    process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION = 'off';
    delete process.env.CLIMATE_CHAIN_MEMORY_KEY;
    await createMemoryRecord(payload);
    const legacyPath = path.join(directory, 'memory-vault.json');
    const legacyBytes = await readFile(legacyPath);

    process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION = 'required';
    process.env.CLIMATE_CHAIN_MEMORY_KEY = Buffer.alloc(32, 19).toString('base64');
    const snapshot = await readMemorySnapshot();
    assert.equal(snapshot.count, 1);
    assert.equal(snapshot.encryption.legacyPlaintextCopy, true);
    assert.match(snapshot.encryption.warning, /retained/u);
    assert.deepEqual(await readFile(legacyPath), legacyBytes);
    assert.equal((await readFile(path.join(directory, 'memory-vault.enc.json'), 'utf8')).includes(payload.rule), false);
    const backups = await listMemoryBackups();
    assert.ok(backups.backups.some((item) => item.encryptedAtRest));
  });
});

test('retrieval audit is authenticated-encrypted with the vault and remains readable through the API', async (t) => {
  await inVault(t, async (directory) => {
    const entry = await createMemoryRecord(payload);
    await searchMemoryRecords({ project: 'climate-chain', query: 'private retrieval marker' });
    const auditPath = path.join(directory, 'retrieval-audit.enc.json');
    const encryptedAudit = await readFile(auditPath, 'utf8');
    assert.equal(encryptedAudit.includes(entry.id), false);
    assert.equal(encryptedAudit.includes('private retrieval marker'), false);
    assert.deepEqual(await readdir(directory).then((names) => names.includes('retrieval-audit.jsonl')), false);
    const trace = await getMemoryRetrievalTrace();
    assert.equal(trace.complete, true);
    assert.equal(trace.events.length, 1);
    assert.equal(trace.events[0].operation, 'search');
    const encryption = (await readMemorySnapshot()).encryption;
    assert.equal(encryption.auditEncryptedAtRest, true);
    assert.equal(encryption.legacyAuditPlaintextCopy, false);
  });
});

test('legacy plaintext retrieval audit is preserved and migrated on its next append', async (t) => {
  await inVault(t, async (directory) => {
    await createMemoryRecord(payload);
    const legacyPath = path.join(directory, 'retrieval-audit.jsonl');
    const legacyText = JSON.stringify({ id: 'legacy-trace-secret-id', at: '2026-10-22T00:00:00.000Z', operation: 'legacy' }) + '\n';
    await writeFile(legacyPath, legacyText);
    await searchMemoryRecords({ project: 'climate-chain', query: 'vault' });

    const storedEnvelope = await readFile(path.join(directory, 'retrieval-audit.enc.json'), 'utf8');
    assert.equal(storedEnvelope.includes('legacy-trace-secret-id'), false);
    assert.equal(await readFile(legacyPath, 'utf8'), legacyText);
    const trace = await getMemoryRetrievalTrace();
    assert.ok(trace.events.some((event) => event.id === 'legacy-trace-secret-id'));
    assert.ok(trace.events.some((event) => event.operation === 'search'));
    const encryption = (await readMemorySnapshot()).encryption;
    assert.equal(encryption.legacyAuditPlaintextCopy, true);
    assert.match(encryption.warning, /plaintext retrieval audit copy is retained/u);
  });
});

test('corrupt encrypted audit fails closed even when a legacy audit copy exists', async (t) => {
  await inVault(t, async (directory) => {
    await createMemoryRecord(payload);
    await searchMemoryRecords({ project: 'climate-chain', query: 'vault' });
    const auditPath = path.join(directory, 'retrieval-audit.enc.json');
    const envelope = JSON.parse(await readFile(auditPath, 'utf8'));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    ciphertext[0] ^= 1;
    envelope.ciphertext = ciphertext.toString('base64');
    await writeFile(auditPath, JSON.stringify(envelope));
    await writeFile(path.join(directory, 'retrieval-audit.jsonl'), JSON.stringify({ id: 'must-not-fallback', at: '2026-10-22T00:00:00.000Z' }) + '\n');
    await assert.rejects(() => getMemoryRetrievalTrace(), /authentication failed/u);
  });
});

test('corrupt encrypted records fail closed without falling back to the legacy plaintext copy', async (t) => {
  await inVault(t, async (directory) => {
    await createMemoryRecord(payload);
    const vaultPath = path.join(directory, 'memory-vault.enc.json');
    const before = await readFile(vaultPath, 'utf8');
    const parsed = JSON.parse(before);
    const cipher = Buffer.from(parsed.ciphertext, 'base64');
    cipher[0] ^= 1;
    parsed.ciphertext = cipher.toString('base64');
    await writeFile(vaultPath, JSON.stringify(parsed));
    const corruptBytes = await readFile(vaultPath);
    await assert.rejects(() => readMemorySnapshot(), /authentication failed/u);
    assert.deepEqual(await readFile(vaultPath), corruptBytes);
    assert.deepEqual(await readdir(directory).then((names) => names.includes('memory-vault.json')), false);
  });
});
