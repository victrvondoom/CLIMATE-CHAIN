import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDatasetsCatalog,
  getTimelineObservations,
  generateObservationEvidenceManifest,
  POLICY_EVENTS
} from '../historical-service.mjs';

test('Historical Service: Datasets catalog is valid and adheres to IEEE standards', () => {
  const catalog = getDatasetsCatalog();
  assert.equal(typeof catalog, 'object');
  assert.ok(catalog.total_cataloged_datasets >= 8, 'Catalog must contain at least 8 verified datasets');
  assert.equal(catalog.datasets.length, catalog.total_cataloged_datasets);

  for (const ds of catalog.datasets) {
    assert.ok(ds.dataset_id, 'Dataset must have dataset_id');
    assert.ok(ds.official_title, 'Dataset must have official_title');
    assert.ok(ds.source_agency, 'Dataset must have source_agency');
    assert.ok(ds.source_url.startsWith('http'), 'Dataset must have valid source_url');
    assert.ok(ds.checksum_sha256 && ds.checksum_sha256.length === 64, 'Dataset must have valid SHA-256');
    assert.ok(ds.citation, 'Dataset must have citation');
    assert.ok(ds.data_license, 'Dataset must have open data license');
  }
});

test('Historical Service: Explicit gaps are preserved for unobserved historical eras', () => {
  // Pre-1880 temperature: explicit gap
  const tempPre1880 = getTimelineObservations('temperature_anomaly', 1850, 1850);
  assert.equal(tempPre1880.observations[0].is_gap, true);
  assert.equal(tempPre1880.observations[0].value, null);
  assert.ok(tempPre1880.observations[0].gap_reason.includes('surface weather stations'));

  // 1990 temperature: observed measurement
  const temp1990 = getTimelineObservations('temperature_anomaly', 1990, 1990);
  assert.equal(temp1990.observations[0].is_gap, false);
  assert.equal(temp1990.observations[0].value, 0.45);
  assert.equal(temp1990.observations[0].uncertainty, 0.04);

  // Pre-1965 renewable share: explicit gap
  const re1950 = getTimelineObservations('renewable_share', 1950, 1950);
  assert.equal(re1950.observations[0].is_gap, true);
  assert.equal(re1950.observations[0].value, null);
});

test('Historical Service: Continuous 200-year span correctly aggregates observations and gaps', () => {
  const span = getTimelineObservations('co2_concentration', 1826, 2026);
  assert.equal(span.observations.length, 201); // 1826 to 2026 inclusive
  assert.equal(span.gap_count, 6); // 1826-1831 (6 years)
  assert.equal(span.observation_count, 195); // 1832-2026 (195 years)

  const latest2026 = span.observations.find(o => o.year === 2026);
  assert.ok(latest2026.value > 420, '2026 atmospheric CO2 must exceed 420 ppm');
  assert.equal(latest2026.unit, 'ppm');
});

test('Historical Service: Policy events milestones are rigorously documented', () => {
  assert.ok(POLICY_EVENTS.length >= 10);
  const cleanAir = POLICY_EVENTS.find(e => e.year === 1970);
  assert.ok(cleanAir);
  assert.equal(cleanAir.title, 'United States Clean Air Act Amendments');
  assert.ok(cleanAir.citation.includes('Public Law 91-604'));

  const paris = POLICY_EVENTS.find(e => e.year === 2015);
  assert.ok(paris);
  assert.equal(paris.title, 'Paris Climate Agreement (COP21)');
});

test('Historical Service: Observation evidence generation produces deterministic SHA-256 manifests', () => {
  const manifest = generateObservationEvidenceManifest('temperature_anomaly', 2024);
  assert.ok(manifest.evidence_id);
  assert.equal(manifest.evidence_id, 'HIST-TEMPERATURE_ANOMALY-2024');
  assert.ok(manifest.sha256_digest && manifest.sha256_digest.length === 64);
  assert.equal(manifest.payload.observed_value, 1.28);
  assert.equal(manifest.payload.source_attribution.dataset_id, 'noaa-ghcn-gistemp-v4');

  // Gap years must refuse evidence creation
  const gapManifest = generateObservationEvidenceManifest('temperature_anomaly', 1860);
  assert.ok(gapManifest.error);
});
