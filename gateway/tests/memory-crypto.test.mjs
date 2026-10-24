import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  decryptMemoryEnvelope,
  encryptMemoryText,
  memoryEncryptionEnabled,
  memoryEncryptionProvider,
  memoryEncryptionStatus,
  memoryKeyringFileName,
  parseDpapiOutput,
  runDpapi,
  rotateMemoryDataKey,
} from '../memory-crypto.mjs';

const temporaryDirectories = new Set();

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-memory-crypto-'));
  temporaryDirectories.add(directory);
  t.after(async () => {
    temporaryDirectories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('DPAPI output parser extracts its marked result despite unrelated PowerShell output', () => {
  const output = 'PowerShell host output\r\nCLIMATE_CHAIN_DPAPI_RESULT:AQID\r\n';
  assert.deepEqual(parseDpapiOutput(output), Buffer.from([1, 2, 3]));
});

test('DPAPI output parser fails closed when the result marker is missing, repeated or malformed', () => {
  assert.throws(() => parseDpapiOutput('PowerShell host output'), /invalid key envelope/u);
  assert.throws(() => parseDpapiOutput('CLIMATE_CHAIN_DPAPI_RESULT:AQID\nCLIMATE_CHAIN_DPAPI_RESULT:BAUG'), /invalid key envelope/u);
  assert.throws(() => parseDpapiOutput('CLIMATE_CHAIN_DPAPI_RESULT:not-base64'), /invalid key envelope/u);
});

test('DPAPI retries one malformed host response, then accepts only a valid marked envelope', () => {
  let calls = 0;
  const spawn = () => {
    calls += 1;
    return {
      error: null,
      status: 0,
      stdout: calls === 1 ? 'CLIMATE_CHAIN_DPAPI_RESULT:not-base64\n' : 'Host output\nCLIMATE_CHAIN_DPAPI_RESULT:AQID\n',
    };
  };
  assert.deepEqual(runDpapi('unprotect', 'opaque-envelope', spawn), Buffer.from([1, 2, 3]));
  assert.equal(calls, 2);
});

test('DPAPI keeps failing closed after its one bounded parse retry', () => {
  let calls = 0;
  const spawn = () => {
    calls += 1;
    return { error: null, status: 0, stdout: 'CLIMATE_CHAIN_DPAPI_RESULT:not-base64\n' };
  };
  assert.throws(() => runDpapi('unprotect', 'opaque-envelope', spawn), /invalid key envelope/u);
  assert.equal(calls, 2);
});

test('AES-256-GCM encrypts content and rejects authenticated tampering', async (t) => {
  const directory = await temporaryDirectory(t);
  const env = { CLIMATE_CHAIN_MEMORY_KEY: Buffer.alloc(32, 7).toString('base64') };
  const source = JSON.stringify({ privateDecision: 'keep this local' });
  const envelope = await encryptMemoryText(directory, source, env);
  assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.equal(JSON.stringify(envelope).includes('keep this local'), false);
  assert.equal(await decryptMemoryEnvelope(directory, envelope, env), source);

  const changed = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext, 'base64').map((byte) => byte ^ 1).toString('base64') };
  await assert.rejects(() => decryptMemoryEnvelope(directory, changed, env), /authentication failed/u);
});

test('configured key mismatch fails closed without returning partial data', async (t) => {
  const directory = await temporaryDirectory(t);
  const firstEnv = { CLIMATE_CHAIN_MEMORY_KEY: Buffer.alloc(32, 1).toString('base64') };
  const secondEnv = { CLIMATE_CHAIN_MEMORY_KEY: Buffer.alloc(32, 2).toString('base64') };
  const envelope = await encryptMemoryText(directory, 'scoped engineering decision', firstEnv);
  await assert.rejects(() => decryptMemoryEnvelope(directory, envelope, secondEnv), /does not match/u);
});

test('Windows DPAPI protects the data key, restarts can decrypt, and rotation retains old backup keys', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await temporaryDirectory(t);
  const env = { CLIMATE_CHAIN_MEMORY_ENCRYPTION: 'required' };
  const first = await encryptMemoryText(directory, 'persistent encrypted memory', env);
  const keyringPath = path.join(directory, memoryKeyringFileName());
  const keyring = await readFile(keyringPath, 'utf8');
  assert.equal(keyring.includes('persistent encrypted memory'), false);
  assert.equal(await decryptMemoryEnvelope(directory, first, env), 'persistent encrypted memory');

  const rotation = await rotateMemoryDataKey(directory, env);
  const second = await encryptMemoryText(directory, 'new key version', env);
  assert.notEqual(second.keyId, first.keyId);
  assert.equal(rotation.previousKeyId, first.keyId);
  assert.equal(rotation.keyId, second.keyId);
  assert.equal(await decryptMemoryEnvelope(directory, first, env), 'persistent encrypted memory');
  assert.equal(await decryptMemoryEnvelope(directory, second, env), 'new key version');
});

test('Windows defaults to DPAPI auto encryption and reports retained plaintext migration copies', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await temporaryDirectory(t);
  const env = {};
  assert.equal(memoryEncryptionEnabled(env, 'win32'), true);
  assert.equal(memoryEncryptionProvider(env, 'win32'), 'Windows DPAPI CurrentUser');
  const before = await memoryEncryptionStatus(directory, env);
  assert.equal(before.enabled, true);
  assert.equal(before.legacyPlaintextCopy, false);
  assert.equal(before.auditEncryptedAtRest, true);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path.join(directory, 'memory-vault.json'), '{"schemaVersion":2}'));
  const after = await memoryEncryptionStatus(directory, env);
  assert.equal(after.activePlaintextVault, true);
  assert.equal(after.legacyPlaintextCopy, false);
  assert.match(after.warning, /awaiting encrypted migration/u);
});
