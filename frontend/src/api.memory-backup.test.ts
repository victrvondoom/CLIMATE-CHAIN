import { describe, expect, it } from 'vitest';
import { decryptPortableMemoryBackup, encryptPortableMemoryBackup, type MemoryBackupEnvelope } from './api';

const backup: MemoryBackupEnvelope = {
  format: 'climate-chain-engineering-memory-backup',
  formatVersion: 2,
  exportedAt: '2026-10-22T00:00:00.000Z',
  store: { entries: [{ id: 'memory-1', rule: 'sensitive-memory-rule' }] },
  integritySha256: 'a'.repeat(64),
};

describe('encrypted portable memory backups', () => {
  it('uses authenticated encryption and restores the verified payload with the passphrase', async () => {
    const encrypted = await encryptPortableMemoryBackup(backup, 'separate-backup-passphrase');
    expect(encrypted.format).toBe('climate-chain-encrypted-memory-backup');
    expect(encrypted.cipher).toBe('AES-256-GCM');
    expect(encrypted.kdf).toBe('PBKDF2-SHA-256');
    expect(encrypted.iterations).toBe(600_000);
    expect(JSON.stringify(encrypted)).not.toContain('sensitive-memory-rule');
    await expect(decryptPortableMemoryBackup(encrypted, 'separate-backup-passphrase')).resolves.toEqual(backup);
  });

  it('rejects wrong passphrases, tampering, and weak passphrases', async () => {
    const encrypted = await encryptPortableMemoryBackup(backup, 'separate-backup-passphrase');
    await expect(decryptPortableMemoryBackup(encrypted, 'incorrect-passphrase')).rejects.toThrow(/authenticate/u);
    const changed = { ...encrypted, ciphertext: `${encrypted.ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}` };
    await expect(decryptPortableMemoryBackup(changed, 'separate-backup-passphrase')).rejects.toThrow(/authenticate/u);
    await expect(encryptPortableMemoryBackup(backup, 'short')).rejects.toThrow(/12 characters/u);
  });
});
