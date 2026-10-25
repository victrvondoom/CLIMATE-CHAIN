import { useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { appendLedger, createEvidence } from '../../core/evidence';
import { Card, Stat } from '../../components/Ui';
import { analyzeEmissions, DASHBOARD_FACTOR_KG_PER_KWH, emissionLevel, regionalFactor } from './domain/carbon';
import { castVote, executeProposal, newProposal, proposalStatus } from './domain/governance';
import {
  cryptoChargeUsdAsWritten,
  ethForUsd,
  netEmissions,
  offsetCostUsd,
  offsetPercentage,
  paypalLink,
  quickPurchaseUsd,
} from './domain/marketplace';
import demo from './fixtures/demo_energy.json';
import projectsFixture from './fixtures/offset_projects.json';
import ballotsFixture from './fixtures/illustrative_ballots.json';
import './module.css';

// What this Page does, in the order it appears. Kept in step with the rendered sections.
const FEATURES = [
  'Carbon analysis: consumption times the dashboard factor, category shares and intensity level',
  'DAO vote tally: token-weighted votes, end-of-window majority and proposal status',
  'Offset marketplace: per-tonne prices, cost, ETH and PayPal amounts, and net-zero progress',
  'Simulated ETH, NFT certificate and PayPal flows: no wallet, chain or PayPal call is made',
];

const MERCHANT_HANDLE = 'your-handle'; // placeholder: the source hard-codes a personal PayPal.me handle, which is not copied

const CARBON = analyzeEmissions(demo.records);
const LEVEL = emissionLevel(CARBON.total);
const JAVA_TOTAL = demo.records.reduce((sum, r) => sum + r.consumption * regionalFactor('java'), 0);

function tallyIllustrative() {
  const { startTime, endTime } = ballotsFixture.proposal;
  const p = newProposal({ startTime, endTime });
  for (const b of ballotsFixture.ballots) {
    castVote(p, { voter: b.voter, support: b.support, weight: b.weight, at: b.at });
  }
  const statusDuringVote = proposalStatus(p, endTime);
  const statusAfterWindow = proposalStatus(p, endTime + 1);
  const passedBeforeExecution = p.passed;
  executeProposal(p, endTime + 1);
  const turnoutPct = ((p.votesFor + p.votesAgainst) / ballotsFixture.proposal.totalSupply) * 100;
  return {
    votesFor: p.votesFor,
    votesAgainst: p.votesAgainst,
    statusDuringVote,
    statusAfterWindow,
    passedBeforeExecution,
    passedAfterExecution: p.passed,
    turnoutPct,
    quorumPct: ballotsFixture.proposal.quorumPercentage,
  };
}

const kg = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const usd = (value: number) => `$${value.toFixed(2)}`;

function RantaiPage() {
  const dao = useMemo(() => tallyIllustrative(), []);
  const [projectId, setProjectId] = useState<string>(projectsFixture.projects[0].id);
  const [amountKg, setAmountKg] = useState<number>(500);
  const [note, setNote] = useState<string | null>(null);

  const project = projectsFixture.projects.find((p) => p.id === projectId) ?? projectsFixture.projects[0];
  const cost = offsetCostUsd(amountKg, project.pricePerTon);
  const remaining = netEmissions(CARBON.total, amountKg);
  const pct = offsetPercentage(CARBON.total, amountKg);

  async function simulatePurchase() {
    try {
      const record = await createEvidence({
        moduleId: 'rantai',
        kind: 'offset-purchase-simulated',
        mode: 'SIMULATED',
        summary: `${project.name}: ${amountKg} kg for ${usd(cost)} (simulated, nothing sent)`,
        payload: {
          projectId: project.id,
          kg: amountKg,
          pricePerTon: project.pricePerTon,
          costUsd: Number(cost.toFixed(2)),
          ethEquivalent: Number(ethForUsd(cost).toFixed(7)),
          simulated: true,
        },
      });
      setNote(
        appendLedger(record)
          ? 'Simulated purchase recorded in this browser ledger. No payment or wallet call was made.'
          : 'Simulated purchase hashed, but browser storage is unavailable, so it was not kept.',
      );
    } catch {
      setNote('Hashing is unavailable in this context, so nothing was recorded.');
    }
  }

  return (
    <div className="m-rantai">
      <header className="m-rantai-head">
        <div>
          <h2 className="m-rantai-title">SupplyTrail</h2>
          <p className="m-rantai-tagline">Web3 carbon management demo: analysis, governance and offsets.</p>
        </div>
        <span className="m-rantai-mode m-rantai-mode-simulated">SIMULATED</span>
      </header>

      <div className="m-rantai-grid">
        <Card className="m-rantai-wide">
          <h3 className="m-rantai-card-title">Carbon analysis <span className="m-rantai-mode m-rantai-mode-simulated">SIMULATED</span></h3>
          <p className="m-rantai-card-sub">
            Each record is consumption times {DASHBOARD_FACTOR_KG_PER_KWH} kg CO₂/kWh (the dashboard factor). Demo records are fictional.
          </p>
          <div className="m-rantai-table-wrap">
            <table className="m-rantai-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Location</th>
                  <th className="m-rantai-num">kWh</th>
                  <th className="m-rantai-num">kg CO₂</th>
                  <th className="m-rantai-num">Share</th>
                </tr>
              </thead>
              <tbody>
                {demo.records.map((r, i) => (
                  <tr key={r.id}>
                    <td>{r.category}</td>
                    <td>{r.location}</td>
                    <td className="m-rantai-num">{kg(r.consumption)}</td>
                    <td className="m-rantai-num">{kg(CARBON.categories[i].value)}</td>
                    <td className="m-rantai-num">{CARBON.categories[i].percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="m-rantai-stats">
            <Stat label="Total" value={kg(CARBON.total)} unit="kg CO₂" />
            <Stat label="Intensity" value={LEVEL.level} hint={LEVEL.description} />
          </div>
          <p className="m-rantai-note">
            The oracle fallback uses regional factors instead. The same records under the Java factor (0.75) give {kg(JAVA_TOTAL)} kg. The
            source does not reconcile the two, and this Page shows the dashboard figure.
          </p>
        </Card>

        <Card className="m-rantai-wide">
          <h3 className="m-rantai-card-title">DAO vote tally <span className="m-rantai-mode m-rantai-mode-simulated">SIMULATED</span></h3>
          <p className="m-rantai-card-sub">
            Illustrative proposal: {ballotsFixture.note} Votes weigh token balances. A majority by weight passes it once the window has ended.
          </p>
          <div className="m-rantai-stats">
            <Stat label="For" value={dao.votesFor} hint="token weight" />
            <Stat label="Against" value={dao.votesAgainst} hint="token weight" />
            <Stat label="Turnout" value={`${dao.turnoutPct.toFixed(0)}%`} hint={`declared quorum ${dao.quorumPct}% (not enforced)`} />
          </div>
          <p className="m-rantai-note">
            During the vote: {dao.statusDuringVote}. After the window: {dao.statusAfterWindow}. The contract's passed flag is{' '}
            {dao.passedBeforeExecution ? 'set' : 'not set'} before execution and {dao.passedAfterExecution ? 'set' : 'not set'} after it.
          </p>
        </Card>

        <Card className="m-rantai-wide">
          <h3 className="m-rantai-card-title">Offset marketplace <span className="m-rantai-mode m-rantai-mode-simulated">SIMULATED</span></h3>
          <p className="m-rantai-card-sub">Price is USD per tonne, and the amount is in kg. Pick a project and an amount to see the arithmetic.</p>
          <div className="m-rantai-form">
            <label>
              Project
              <select className="m-rantai-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projectsFixture.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({usd(p.pricePerTon)}/t)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (kg CO₂)
              <input
                className="m-rantai-input"
                type="number"
                min={0}
                step={100}
                value={amountKg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAmountKg(Number.isFinite(v) && v > 0 ? v : 0);
                }}
              />
            </label>
          </div>
          <div className="m-rantai-stats">
            <Stat label="Cost" value={usd(cost)} hint={`${amountKg} kg at ${usd(project.pricePerTon)}/t`} />
            <Stat label="ETH equivalent" value={ethForUsd(cost).toFixed(7)} hint="1 USD = 0.0003 ETH (simulated)" />
            <Stat label="Net left" value={kg(remaining)} unit="kg CO₂" hint={`${pct.toFixed(1)}% offset`} />
          </div>
          <p className="m-rantai-note">
            PayPal link (merchant placeholder): <span className="m-rantai-code">{paypalLink(cost, MERCHANT_HANDLE)}</span>
          </p>
          <p className="m-rantai-note">
            Net zero: {remaining <= 0 ? 'reached' : `${kg(remaining)} kg still to offset, which costs ${usd(quickPurchaseUsd(remaining))} at the flat $15 quick-purchase rate`}.
          </p>
          <p className="m-rantai-warn">
            Source bug: the crypto path charges {usd(cryptoChargeUsdAsWritten(amountKg, project.pricePerTon))} for this purchase, not{' '}
            {usd(cost)}, because it multiplies kg by the price per tonne. The Page shows the intended cost.
          </p>
          <button type="button" className="m-rantai-button" onClick={() => void simulatePurchase()}>
            Record simulated purchase
          </button>
          {note ? <p className="m-rantai-note">{note}</p> : null}
        </Card>

        <Card className="m-rantai-wide">
          <h3 className="m-rantai-card-title">Payment and certificate flows <span className="m-rantai-mode m-rantai-mode-simulated">SIMULATED</span></h3>
          <ol className="m-rantai-list">
            <li>Certificate metadata to IPFS: simulated, not uploaded.</li>
            <li>ETH payment on Sepolia: simulated, no wallet is connected and no transaction is sent.</li>
            <li>NFT certificate mint: simulated, no contract is called.</li>
            <li>PayPal checkout: the link above only, nothing is charged.</li>
          </ol>
          <p className="m-rantai-note">
            Not ported: the Pinata and IPFS uploads, the Sepolia contracts and NFT minting, wallet connection, the Farcaster wrapper, the
            Prisma data layer, and the live oracle reads (the regional factors are the fallback values).
          </p>
        </Card>
      </div>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'rantai',
  name: 'SupplyTrail',
  tagline: 'Web3 carbon management demo: analysis, governance and offsets.',
  stages: ['finance', 'prove'],
  tone: 'carbon',
  mode: 'SIMULATED',
  features: FEATURES,
  source: {
    folder: 'rantai-3c-master',
    files: [
      'src/app/dashboard/page.tsx',
      'src/components/CarbonAnalysis.tsx',
      'src/utils/oracle.ts',
      'src/utils/governance.ts',
      'src/contracts/CarbonDAO.sol',
      'src/components/CarbonOffsetMarketplace.tsx',
      'src/components/PaymentModal.tsx',
      'src/utils/offsetPayment.ts',
    ],
  },
  Page: RantaiPage,
};

export default climateModule;
