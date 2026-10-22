import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, link, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const KEYRING_NAME = '.memory-vault-keyring.json';
const KEYRING_FORMAT = 'climate-chain-memory-keyring';
const ENCRYPTED_FORMAT = 'climate-chain-memory-encrypted';
const AAD_PREFIX = 'climate-chain-memory-v3';
const MAX_KEYRING_BYTES = 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 32 * 1024 * 1024;
const DPAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'Add-Type -AssemblyName System.Security',
  '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$bytes = [Convert]::FromBase64String($request.payload)',
  'if ($request.operation -eq \'protect\') {',
  '  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '} elseif ($request.operation -eq \'unprotect\') {',
  '  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '} else { throw \'Unsupported DPAPI operation\' }',
  '[Console]::Out.WriteLine([Convert]::ToBase64String($result))',
].join('; ');
const DPAPI_COMMAND = Buffer.from(DPAPI_SCRIPT, 'utf16le').toString('base64');

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function keyId(key) {
  return digest(key).slice(0, 24);
}

function validBase64(value, expectedLength) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value && (expectedLength === undefined || decoded.length === expectedLength);
}

export function memoryEncryptionEnabled(env = process.env, platform = process.platform) {
  if (env.CLIMATE_CHAIN_MEMORY_KEY) return true;
  const setting = env.CLIMATE_CHAIN_MEMORY_ENCRYPTION || 'auto';
  if (setting === 'off') return false;
  if (setting === 'required') return true;
  if (setting !== 'auto') throw new TypeError('CLIMATE_CHAIN_MEMORY_ENCRYPTION must be auto, required, or off.');
  return platform === 'win32';
}

export function memoryEncryptionProvider(env = process.env, platform = process.platform) {
  if (env.CLIMATE_CHAIN_MEMORY_KEY) return 'external-32-byte-key';
  if (platform === 'win32') return 'Windows DPAPI CurrentUser';
  return 'unavailable';
}

function runDpapi(operation, payload) {
  const child = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', DPAPI_COMMAND,
  ], {
    input: JSON.stringify({ operation, payload }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 8192,
  });
  if (child.error || child.status !== 0) {
    throw new Error('Windows DPAPI could not protect or unlock the local memory key. The vault was not changed.');
  }
  const output = child.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (!validBase64(output)) throw new Error('Windows DPAPI returned an invalid key envelope. The vault was not changed.');
  return Buffer.from(output, 'base64');
}

function parseExternalKey(env) {
  const value = env.CLIMATE_CHAIN_MEMORY_KEY;
  if (!validBase64(value, 32)) {
    throw new Error('CLIMATE_CHAIN_MEMORY_KEY must be a canonical base64 encoding of exactly 32 bytes.');
  }
  return Buffer.from(value, 'base64');
}

async function readKeyring(path) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_KEYRING_BYTES) {
    throw new Error('Memory keyring must be a bounded regular file. The vault was not changed.');
  }
  let keyring;
  try { keyring = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('Memory keyring is unreadable. The vault was not changed.'); }
  if (!keyring || keyring.format !== KEYRING_FORMAT || keyring.version !== 1
    || !Array.isArray(keyring.keys) || keyring.keys.length < 1 || keyring.keys.length > 100
    || typeof keyring.currentKeyId !== 'string') {
    throw new Error('Memory keyring format is invalid. The vault was not changed.');
  }
  for (const item of keyring.keys) {
    if (!item || !/^[a-f0-9]{24}$/u.test(item.id) || item.provider !== 'Windows DPAPI CurrentUser'
      || !validBase64(item.protectedKey) || item.protectedKey.length > 4096) {
      throw new Error('Memory keyring contains an invalid protected key. The vault was not changed.');
    }
  }
  if (!keyring.keys.some((item) => item.id === keyring.currentKeyId)) {
    throw new Error('Memory keyring current key is missing. The vault was not changed.');
  }
  return keyring;
}

async function writeKeyring(directory, keyring, createOnly = false) {
  const path = join(directory, KEYRING_NAME);
  const temporary = join(directory, KEYRING_NAME + '.' + randomBytes(8).toString('hex') + '.tmp');
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(keyring, null, 2) + '\n', 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  try {
    if (createOnly) await link(temporary, path);
    else await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (createOnly && error?.code === 'EEXIST') return;
    throw error;
  }
  await unlink(temporary).catch(() => {});
}

async function createKeyring(directory) {
  const key = randomBytes(32);
  const id = keyId(key);
  const protectedKey = runDpapi('protect', key.toString('base64')).toString('base64');
  const ring = {
    format: KEYRING_FORMAT,
    version: 1,
    currentKeyId: id,
    keys: [{ id, provider: 'Windows DPAPI CurrentUser', protectedKey, createdAt: new Date().toISOString() }],
  };
  await writeKeyring(directory, ring, true);
  return ring;
}

async function getKey(directory, requestedId, env = process.env) {
  if (env.CLIMATE_CHAIN_MEMORY_KEY) {
    const key = parseExternalKey(env);
    const id = keyId(key);
    if (requestedId && requestedId !== id) throw new Error('The configured memory key does not match this encrypted vault. No data was returned.');
    return { key, id, provider: 'external-32-byte-key' };
  }
  if (process.platform !== 'win32') {
    throw new Error('Encrypted memory requires Windows DPAPI or CLIMATE_CHAIN_MEMORY_KEY. No data was returned.');
  }
  const path = join(directory, KEYRING_NAME);
  let ring = await readKeyring(path);
  if (!ring) {
    await createKeyring(directory);
    ring = await readKeyring(path);
  }
  const selectedId = requestedId || ring.currentKeyId;
  const item = ring.keys.find((candidate) => candidate.id === selectedId);
  if (!item) throw new Error('Encrypted memory references a missing key version. No data was returned.');
  const key = runDpapi('unprotect', item.protectedKey.toString());
  if (key.length !== 32 || keyId(key) !== item.id) throw new Error('Protected memory key failed its identity check. No data was returned.');
  return { key, id: item.id, provider: item.provider };
}

export function isEncryptedMemoryEnvelope(value) {
  return Boolean(value && typeof value === 'object' && value.format === ENCRYPTED_FORMAT);
}

export async function encryptMemoryText(directory, plaintext, env = process.env) {
  if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext, 'utf8') > MAX_CIPHERTEXT_BYTES) {
    throw new TypeError('Memory payload is outside the encryption size limit.');
  }
  const { key, id, provider } = await getKey(directory, undefined, env);
  const iv = randomBytes(12);
  const aad = Buffer.from(`${AAD_PREFIX}:1:${id}`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    format: ENCRYPTED_FORMAT,
    formatVersion: 1,
    cipher: 'AES-256-GCM',
    keyId: id,
    keyProvider: provider,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export async function decryptMemoryEnvelope(directory, envelope, env = process.env) {
  if (!isEncryptedMemoryEnvelope(envelope) || envelope.formatVersion !== 1 || envelope.cipher !== 'AES-256-GCM'
    || !/^[a-f0-9]{24}$/u.test(envelope.keyId || '') || !validBase64(envelope.iv, 12)
    || !validBase64(envelope.authTag, 16) || !validBase64(envelope.ciphertext)
    || envelope.ciphertext.length > Math.ceil(MAX_CIPHERTEXT_BYTES * 4 / 3) + 8) {
    throw new Error('Encrypted memory envelope is invalid. No partial data was returned.');
  }
  const { key, id } = await getKey(directory, envelope.keyId, env);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${AAD_PREFIX}:1:${id}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Memory vault authentication failed. No partial data was returned.');
  }
}

export async function rotateMemoryDataKey(directory, env = process.env) {
  if (env.CLIMATE_CHAIN_MEMORY_KEY || process.platform !== 'win32') {
    throw new Error('Key rotation requires the Windows DPAPI key provider; the external key remains user-managed.');
  }
  const path = join(directory, KEYRING_NAME);
  const ring = await readKeyring(path) || await createKeyring(directory);
  if (ring.keys.length >= 100) throw new Error('Memory key history is full; export and validate encrypted backups before retiring old keys.');
  const key = randomBytes(32);
  const id = keyId(key);
  if (ring.keys.some((item) => item.id === id)) throw new Error('Generated memory key ID already exists; retry rotation.');
  const protectedKey = runDpapi('protect', key.toString('base64')).toString('base64');
  const updated = {
    ...ring,
    currentKeyId: id,
    keys: [...ring.keys, { id, provider: 'Windows DPAPI CurrentUser', protectedKey, createdAt: new Date().toISOString() }],
  };
  await writeKeyring(directory, updated);
  return { keyId: id, previousKeyId: ring.currentKeyId, retainedKeyVersions: updated.keys.length };
}

export async function memoryEncryptionStatus(directory, env = process.env) {
  const enabled = memoryEncryptionEnabled(env);
  const encryptedPath = join(directory, 'memory-vault.enc.json');
  const plaintextPath = join(directory, 'memory-vault.json');
  const encryptedAuditPath = join(directory, 'retrieval-audit.enc.json');
  const plaintextAuditPath = join(directory, 'retrieval-audit.jsonl');
  async function present(path) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('Memory storage path is not a regular file.');
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  const [encryptedVault, plaintextVaultPresent, encryptedAudit, plaintextAuditPresent] = await Promise.all([
    present(encryptedPath), present(plaintextPath), present(encryptedAuditPath), present(plaintextAuditPath),
  ]);
  const vaultEncrypted = encryptedVault || enabled;
  const legacyPlaintextCopy = encryptedVault && plaintextVaultPresent;
  const legacyAuditPlaintextCopy = encryptedAudit && plaintextAuditPresent;
  const auditEncryptedAtRest = encryptedAudit || (vaultEncrypted && !plaintextAuditPresent);
  const warnings = [];
  if (legacyPlaintextCopy) warnings.push('An original plaintext vault copy is retained for reversible migration; review and secure it according to your retention policy.');
  else if (plaintextVaultPresent && vaultEncrypted) warnings.push('A plaintext vault file is awaiting encrypted migration. Its contents are preserved until a successful vault read migrates them.');
  else if (plaintextVaultPresent) warnings.push('The active memory vault is stored as plaintext because vault encryption is disabled.');
  if (legacyAuditPlaintextCopy) {
    warnings.push('A plaintext retrieval audit copy is retained for reversible migration; review and secure it according to your retention policy.');
  } else if (plaintextAuditPresent && vaultEncrypted) {
    warnings.push('A plaintext retrieval audit is awaiting encrypted migration on the next retrieval append; its current bytes are preserved.');
  } else if (plaintextAuditPresent) {
    warnings.push('The retrieval audit is currently stored as plaintext JSONL because vault encryption is disabled.');
  }
  return {
    enabled: vaultEncrypted,
    algorithm: vaultEncrypted ? 'AES-256-GCM' : null,
    keyProtection: vaultEncrypted ? memoryEncryptionProvider(env) : 'none',
    activePlaintextVault: plaintextVaultPresent && !encryptedVault,
    auditEncryptedAtRest,
    plaintextAuditPresent,
    legacyPlaintextCopy,
    legacyAuditPlaintextCopy: legacyAuditPlaintextCopy && (encryptedAudit || vaultEncrypted),
    warning: warnings.length ? warnings.join(' ') : null,
  };
}

export function encryptedMemoryFileName() {
  return 'memory-vault.enc.json';
}

export function memoryKeyringFileName() {
  return KEYRING_NAME;
}
