// Port of the carbon-analysis rules in projects/rantai-3c-master:
//   - src/app/dashboard/page.tsx: each record is consumption (kWh) times a flat 0.5 kg CO2/kWh;
//     a category's share is round(value / total * 100), and 0 when the total is 0.
//   - src/components/CarbonAnalysis.tsx: intensity level from the total (kg CO2).
//   - src/utils/oracle.ts: regional emission factors, used by the oracle fallback when the chain
//     cannot be reached. The source keeps this table apart from the dashboard factor and does
//     not reconcile the two; this port keeps both as the source does.

export const DASHBOARD_FACTOR_KG_PER_KWH = 0.5;

const REGIONAL_FACTORS: Record<string, number> = {
  indonesia: 0.85,
  java: 0.75,
  kalimantan: 0.92,
  sulawesi: 0.8,
  sumatra: 0.88,
};

export interface EnergyRecord {
  id: string;
  category: string;
  consumption: number; // kWh
  location: string;
}

export interface CategoryEmission {
  id: string;
  category: string;
  value: number; // kg CO2
  percentage: number;
}

export function regionalFactor(region: string): number {
  return REGIONAL_FACTORS[region.toLowerCase()] ?? 0.85;
}

export function analyzeEmissions(
  records: EnergyRecord[],
  factor: number = DASHBOARD_FACTOR_KG_PER_KWH,
): { categories: CategoryEmission[]; total: number } {
  const values = records.map((r, index) => ({
    id: `emission-${index}`,
    category: r.category || 'General',
    value: r.consumption * factor,
  }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  return {
    total,
    categories: values.map((item) => ({
      ...item,
      percentage: total > 0 ? Math.round((item.value / total) * 100) : 0,
    })),
  };
}

export interface EmissionLevel {
  level: 'Low' | 'Moderate' | 'High' | 'Very High';
  description: string;
}

// Thresholds in kg CO2, as getEmissionLevel in CarbonAnalysis.tsx compares them (strictly below each bound).
export function emissionLevel(total: number): EmissionLevel {
  if (total < 100) return { level: 'Low', description: 'Excellent! Your carbon footprint is very low.' };
  if (total < 500) return { level: 'Moderate', description: "Good effort. There's room for improvement." };
  if (total < 1000) return { level: 'High', description: 'Consider reducing your energy consumption.' };
  return { level: 'Very High', description: 'Immediate action recommended to reduce emissions.' };
}
