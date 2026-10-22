import { describe, expect, it } from 'vitest';
import {
  ETH_PER_USD,
  cryptoChargeUsdAsWritten,
  ethForUsd,
  netEmissions,
  offsetCostUsd,
  offsetPercentage,
  paypalLink,
  quickPurchaseUsd,
} from './marketplace';
import projects from '../fixtures/offset_projects.json';
import { analyzeEmissions } from './carbon';
import demo from '../fixtures/demo_energy.json';

// Rules ported from projects/rantai-3c-master/src/components/CarbonOffsetMarketplace.tsx
// (cost, net emissions, offset percentage, net zero), src/components/PaymentModal.tsx
// (calculateTotalCost) and src/utils/offsetPayment.ts (ETH rate, PayPal link).

describe('marketplace listing', () => {
  it('lists the four source projects at their source prices (USD per tonne)', () => {
    expect(projects.projects.map((p) => p.pricePerTon)).toEqual([15, 12, 18, 25]);
    expect(projects.projects.map((p) => p.id)).toEqual(['reforest-indo', 'solar-java', 'mangrove-sulawesi', 'ccus-jakarta']);
  });
});

describe('cost of an offset', () => {
  it('is kilograms over 1000 times the price per tonne (PaymentModal calculateTotalCost)', () => {
    expect(offsetCostUsd(1000, 15)).toBe(15);
    expect(offsetCostUsd(2500, 12)).toBe(30);
    expect(offsetCostUsd(50000, 25)).toBe(1250);
  });

  it('quick purchase for the remaining emissions uses the flat $15 the source hard-codes, not the project price', () => {
    expect(quickPurchaseUsd(539.05)).toBeCloseTo(8.08575, 6);
  });
});

describe('net-zero progress', () => {
  const total = analyzeEmissions(demo.records).total;

  it('shows what is left after a partial purchase, and the share offset', () => {
    expect(netEmissions(total, 500)).toBeCloseTo(539.05, 6);
    expect(offsetPercentage(total, 500)).toBeCloseTo(48.1209, 3);
  });

  it('reaches net zero when purchases equal or exceed the total', () => {
    expect(netEmissions(total, total)).toBeCloseTo(0, 6);
    expect(offsetPercentage(total, total)).toBeCloseTo(100, 6);
    expect(offsetPercentage(total, total + 10)).toBeGreaterThan(100);
  });

  it('gives 0 percent when there are no emissions to offset (the source would print NaN)', () => {
    expect(offsetPercentage(0, 0)).toBe(0);
  });
});

describe('payment flows (simulated; no wallet or PayPal call is made)', () => {
  it('converts USD to ETH at the source rate of 0.0003 ETH per USD', () => {
    expect(ETH_PER_USD).toBe(0.0003);
    expect(ethForUsd(15)).toBeCloseTo(0.0045, 9);
  });

  it('builds the PayPal.me link from the amount in USD, with the merchant handle passed in', () => {
    expect(paypalLink(15, 'merchant-handle')).toBe('https://www.paypal.com/paypalme/merchant-handle/15.00USD');
  });

  it('documents a 1000x unit error: the crypto path multiplies kilograms by a price per tonne', () => {
    // The marketplace passes amount (kg) and project.pricePerTon into purchaseOffsetWithCrypto,
    // which treats its price argument as USD per kg.
    const shown = offsetCostUsd(1000, 15);
    const asWritten = cryptoChargeUsdAsWritten(1000, 15);
    expect(shown).toBe(15);
    expect(asWritten).toBe(15000);
    expect(asWritten / shown).toBe(1000);
    expect(ethForUsd(asWritten)).toBeCloseTo(4.5, 9);
  });
});
