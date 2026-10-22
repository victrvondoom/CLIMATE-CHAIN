import { useEffect, useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { Card, Stat } from '../../components/Ui';
import scenarioDoc from './fixtures/scenarios-demo.json';
import bundleDoc from './fixtures/bundles-demo.json';
import { assess, type Assessment } from './domain/score';
import { RegistryLock } from './domain/lock';
import { checkBundle, type BundleCheck } from './domain/rehash';
import './module.css';

const VINTAGE = 2025;

interface MintedProject {
  id: number;
  title: string;
  tonnes: number;
  cells: number;
  revoked: boolean;
}

function matchesSource(golden: { score: number; approved: boolean; verifiedTonnes: number }, a: Assessment) {
  return a.score === golden.score && a.approved === golden.approved && a.verifiedTonnes === golden.verifiedTonnes;
}

function CarbonTracePage() {
  const results = useMemo(
    () =>
      scenarioDoc.scenarios.map((s) => {
        const a = assess({ areaHa: s.geometry.areaHa, cells: s.geometry.cells }, s.satellite, s.request.claimedTonnes);
        return { s, a, matches: matchesSource(s.golden, a) };
      }),
    [],
  );
  const [selectedId, setSelectedId] = useState(scenarioDoc.scenarios[0].id);
  const selected = results.find((r) => r.s.id === selectedId) ?? results[0];

  const [lock] = useState(() => new RegistryLock());
  const [minted, setMinted] = useState<MintedProject[]>([]);
  const [reverts, setReverts] = useState(0);
  const [lockMsg, setLockMsg] = useState('');

  function mint(title: string, tonnes: number, cells: number[]) {
    const id = lock.projectCount + 1;
    const result = lock.claim(VINTAGE, cells, id);
    if (result.ok) {
      setMinted((list) => [...list, { id, title, tonnes, cells: cells.length, revoked: false }]);
      setLockMsg(`Minted project ${id}: ${tonnes} t verified for ${title}.`);
    } else {
      setReverts((n) => n + 1);
      setLockMsg(
        result.reason === 'CellAlreadyClaimed'
          ? `Reverted: cell ${result.cell} already backs project ${result.existing} in ${VINTAGE}. Nothing was minted.`
          : `Reverted: ${result.reason}. Nothing was minted.`,
      );
    }
  }

  function revoke(id: number) {
    lock.revoke(id);
    setMinted((list) => list.map((p) => (p.id === id ? { ...p, revoked: true } : p)));
    setLockMsg(`Revoked project ${id}. Its cells are free for a new claim.`);
  }

  const [tamper, setTamper] = useState(false);
  const [checks, setChecks] = useState<Record<string, BundleCheck>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(
      bundleDoc.records.map(async (r, i) => {
        let payload: unknown = r.payload;
        if (tamper && i === 0) {
          const copy = JSON.parse(JSON.stringify(r.payload)) as { assessment: { verifiedTonnes: number } };
          copy.assessment.verifiedTonnes += 100;
          payload = copy;
        }
        return [r.id, await checkBundle({ sha256: r.sha256, payload })] as const;
      }),
    )
      .then((pairs) => {
        if (alive) setChecks(Object.fromEntries(pairs));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tamper]);

  const approvedCount = results.filter((r) => r.a.approved).length;
  const matchCount = results.filter((r) => r.matches).length;
  const liveProjects = minted.filter((p) => !p.revoked).length;

  return (
    <div className="m-carbontrace-root">
      <Card className="m-carbontrace-head">
        <div className="m-carbontrace-title-row">
          <h2>CarbonTrace</h2>
          <span className="m-carbontrace-mode">DEMO</span>
          <span className="m-carbontrace-chip">preset scenarios, simulated satellite series</span>
        </div>
        <p>
          The verifier scores each claim from satellite observations, trims credits to what the land can hold, and
          refuses a second claim over the same cells in the same vintage. The data is demo data from the source.
        </p>
        <p className="m-carbontrace-note">{scenarioDoc.note}</p>
      </Card>

      <div className="m-carbontrace-stats">
        <Stat label="Claims approved" value={`${approvedCount} of ${results.length}`} hint="by the verifier score" />
        <Stat label="Source match" value={`${matchCount} of ${results.length}`} hint="same output as the source assess()" />
        <Stat label="Projects on the lock" value={liveProjects} hint={`${reverts} claim(s) reverted`} />
      </div>

      <section className="m-carbontrace-verifier" aria-label="Verifier">
        <h3>Verifier and claim trimming</h3>
        <div className="m-carbontrace-scenarios">
          {results.map((r) => (
            <button
              key={r.s.id}
              type="button"
              className={`m-carbontrace-scenario${r.s.id === selected.s.id ? ' is-selected' : ''}`}
              onClick={() => setSelectedId(r.s.id)}
            >
              <span className="m-carbontrace-scenario-title">{r.s.title}</span>
              <span className="m-carbontrace-meta">
                score {r.a.score} · {r.a.approved ? `approved, ${r.a.verifiedTonnes} t` : 'not approved'} · claimed{' '}
                {r.s.request.claimedTonnes} t
              </span>
            </button>
          ))}
        </div>

        <Card>
          <h4>{selected.s.title}</h4>
          <p className="m-carbontrace-meta">
            Capacity {selected.a.capacityTonnes.toLocaleString('en-US')} t · claim to capacity{' '}
            {selected.a.metrics.claim_to_capacity_ratio ?? 'n/a'} · caps:{' '}
            {selected.a.capsApplied.length ? selected.a.capsApplied.join(', ') : 'none'}
          </p>
          <table className="m-carbontrace-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {selected.a.checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className={`m-carbontrace-status m-carbontrace-status-${c.status}`}>{c.status}</td>
                  <td>{c.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-carbontrace-meta">
            {selected.matches ? 'Matches the source golden output.' : 'Does not match the source golden output.'}
          </p>
        </Card>
      </section>

      <Card>
        <h3>Registry cell lock, vintage {VINTAGE}</h3>
        <p className="m-carbontrace-meta">
          Mint an approved claim. Its grid cells are locked for the vintage. Minting the same cells again reverts.
        </p>
        <div className="m-carbontrace-actions">
          {results
            .filter((r) => r.a.approved)
            .map((r) => (
              <button key={r.s.id} type="button" onClick={() => mint(r.s.title, r.a.verifiedTonnes, r.s.geometry.cells)}>
                Mint: {r.s.title}
              </button>
            ))}
        </div>
        {lockMsg ? <p role="status" className="m-carbontrace-meta">{lockMsg}</p> : null}
        {minted.length === 0 ? (
          <p className="m-carbontrace-meta">No projects minted in this session.</p>
        ) : (
          <ul className="m-carbontrace-list">
            {minted.map((p) => (
              <li key={p.id}>
                Project {p.id}: {p.title}, {p.tonnes} t, {p.cells} cells · {p.revoked ? 'revoked, cells released' : 'active'}{' '}
                {p.revoked ? null : (
                  <button type="button" onClick={() => revoke(p.id)}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3>Evidence re-hash</h3>
        <p className="m-carbontrace-meta">
          Each bundle is canonical JSON hashed with SHA-256 and compared with the stored hash. The source commits keccak256
          on-chain. This app uses SHA-256 because WebCrypto has no keccak256.
        </p>
        <div className="m-carbontrace-actions">
          <button type="button" onClick={() => setTamper((t) => !t)}>
            {tamper ? 'Undo the edit' : 'Edit the first bundle (+100 t) and re-hash'}
          </button>
        </div>
        <ul className="m-carbontrace-list">
          {bundleDoc.records.map((r) => {
            const c = checks[r.id];
            return (
              <li key={r.id}>
                <span>{r.summary}</span>{' '}
                <code>stored {r.sha256.slice(0, 12)}</code>{' '}
                <code>computed {c ? c.computed.slice(0, 12) : '...'}</code>{' '}
                <span className="m-carbontrace-meta">{!c ? 'checking' : c.ok ? 'match' : 'mismatch'}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h3>Not ported</h3>
        <ul className="m-carbontrace-list">
          <li>The EIP-712 attestation signing and checking, and the on-chain mint and retirement transactions.</li>
          <li>Polygon rasterisation into cells (shapely). The cell lists come from the source output.</li>
          <li>The Sentinel-2 provider. The observations are the source's simulated series, not satellite data.</li>
          <li>keccak256 on the bundle. The browser re-hash uses SHA-256. IPFS pinning and the LLM explanation.</li>
        </ul>
      </Card>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'carbontrace',
  name: 'CarbonTrace',
  tagline: 'Carbon credits checked against satellite evidence before they exist.',
  stages: ['verify', 'finance', 'prove'],
  tone: 'carbon',
  mode: 'DEMO',
  features: [
    'Verifier score from NDVI canopy, greenness, clearing and claim fit, with hard caps',
    'Claim trimming: approved credits are capped at the land capacity and rounded down',
    'Registry cell lock: a second claim over any cell in the same vintage reverts',
    'Evidence re-hash: canonical bundle, SHA-256, compared with the stored hash',
    'Preset scenarios checked against the source output',
  ],
  source: {
    folder: 'CarbonTrace-main',
    files: [
      'backend/app/scoring.py',
      'backend/app/scenarios.py',
      'backend/app/geo.py',
      'backend/app/evidence.py',
      'backend/tests/test_scoring.py',
      'contracts-pkg/contracts/CarbonTraceRegistry.sol',
      'contracts-pkg/test/CarbonTraceRegistry.test.js',
    ],
  },
  Page: CarbonTracePage,
};

export default climateModule;
