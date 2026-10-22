// Audit rules from docs/LEAKAGE_AUDIT.md, applied to the partition that
// data/benchmark/leakage_audit.json records. No stress test is run here.

// Ex-post names that LEAKAGE_AUDIT.md lists as forbidden as ex-ante model inputs.
export const FORBIDDEN_EX_POST = [
  'independent_counterfactual_estimate',
  'independent_counterfactual_credits',
  'counterfactual_confidence_interval_lower',
  'counterfactual_confidence_interval_upper',
  'evaluation_method',
  'over_crediting_ratio',
  'achievement_ratio',
  'statistical_significance',
  'p_value',
  'covariate_balance_statistics',
  'parallel_trends_test_p_value',
  'placebo_test_results',
  'synthetic_control_weights',
  'matched_control_deforestation_rates',
] as const;

export interface LeakageAudit {
  checks: { ex_ante_columns: string[]; ex_post_columns: string[] };
  fields_partitioned: { ex_ante: string[]; ex_post: string[] };
  rationale: { ex_ante: Record<string, string>; ex_post: Record<string, string> };
}

export interface LeakageRule {
  id: string;
  source: string;
  rule: string;
  passed: boolean;
  detail: string[];
}

const overlap = (a: readonly string[], b: readonly string[]) => a.filter((x) => b.includes(x));
const missingFrom = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));

export function auditLeakage(audit: LeakageAudit): LeakageRule[] {
  const checkAnte = audit.checks.ex_ante_columns;
  const checkPost = audit.checks.ex_post_columns;
  const partAnte = audit.fields_partitioned.ex_ante;
  const partPost = audit.fields_partitioned.ex_post;
  const ante = new Set([...checkAnte, ...partAnte]);

  const rule = (id: string, source: string, text: string, detail: string[]): LeakageRule => ({
    id,
    source,
    rule: text,
    passed: detail.length === 0,
    detail,
  });

  const rationaleGaps = [
    ...partAnte.filter((f) => !Object.hasOwn(audit.rationale.ex_ante, f)),
    ...partPost.filter((f) => !Object.hasOwn(audit.rationale.ex_post, f)),
  ];

  return [
    rule(
      'checks-disjoint',
      'LEAKAGE_AUDIT.md, validation checklist: no field in both schemas',
      'No column is listed as both ex-ante and ex-post',
      overlap(checkAnte, checkPost),
    ),
    rule(
      'partition-disjoint',
      'LEAKAGE_AUDIT.md, validation checklist: no field in both schemas',
      'No field is classified as both ex-ante and ex-post',
      overlap(partAnte, partPost),
    ),
    rule(
      'forbidden-absent',
      'LEAKAGE_AUDIT.md, Ex-Post Fields (FORBIDDEN)',
      'No forbidden ex-post name appears among ex-ante fields',
      FORBIDDEN_EX_POST.filter((name) => ante.has(name)),
    ),
    rule(
      'ex-ante-classified',
      'LEAKAGE_AUDIT.md, configuration-based classification',
      'Every ex-ante column is classified as ex-ante',
      missingFrom(checkAnte, partAnte),
    ),
    rule(
      'rationale',
      'LEAKAGE_AUDIT.md, validation checklist: classification documented with rationale',
      'Every classified field has a rationale',
      rationaleGaps,
    ),
  ];
}
