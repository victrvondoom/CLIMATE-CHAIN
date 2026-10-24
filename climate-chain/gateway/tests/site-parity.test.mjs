// The frontend offers Integrity Lab hand-offs from its own copy of the site list
// (frontend/src/core/places.ts). This keeps that copy equal to the gateway's SITES.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITES } from '../integrity-sources.mjs';

test('frontend integrity sites match the gateway site list', async () => {
  const source = await readFile(new URL('../../frontend/src/core/places.ts', import.meta.url), 'utf8');
  const block = /INTEGRITY_SITES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
  const frontend = [...block.matchAll(/id: '([^']+)', label: '([^']+)', lat: ([\d.-]+), lng: ([\d.-]+)/g)]
    .map(([, id, label, lat, lng]) => ({ id, label, lat: Number(lat), lng: Number(lng) }));
  assert.deepEqual(frontend, SITES.map(({ id, label, lat, lon }) => ({ id, label, lat, lng: lon })));
});
