// Price and progress rules of the source offset marketplace:
//   - PaymentModal.tsx calculateTotalCost and CarbonOffsetMarketplace.tsx: cost = (kg / 1000) * USD per tonne.
//   - CarbonOffsetMarketplace.tsx: net = total - purchased; percent = purchased / total * 100; net zero
//     when purchased >= total. The source divides by zero when total is 0; this port returns 0.
//   - CarbonOffsetMarketplace.tsx quick purchase: remaining kg / 1000 * 15 (a flat $15 in the source).
//   - offsetPayment.ts: 1 USD = 0.0003 ETH, and the PayPal.me link carries the amount in USD.
// The source's crypto path (purchaseOffsetWithCrypto) receives kg and a price per tonne, then
// multiplies them as if the price were per kg. cryptoChargeUsdAsWritten models that arithmetic,
// so the Page can show the difference. Nothing here sends a payment.

export const ETH_PER_USD = 0.0003;

export function offsetCostUsd(kg: number, pricePerTon: number): number {
  return (kg / 1000) * pricePerTon;
}

export function quickPurchaseUsd(remainingKg: number): number {
  return (remainingKg / 1000) * 15;
}

export function netEmissions(total: number, purchased: number): number {
  return total - purchased;
}

export function offsetPercentage(total: number, purchased: number): number {
  return total > 0 ? (purchased / total) * 100 : 0;
}

export function ethForUsd(usd: number): number {
  return usd * ETH_PER_USD;
}

export function paypalLink(amountUsd: number, merchantHandle: string): string {
  return `https://www.paypal.com/paypalme/${merchantHandle}/${amountUsd.toFixed(2)}USD`;
}

// What purchaseOffsetWithCrypto charges as written: kilograms times the price per tonne.
export function cryptoChargeUsdAsWritten(kg: number, pricePerTon: number): number {
  return kg * pricePerTon;
}
