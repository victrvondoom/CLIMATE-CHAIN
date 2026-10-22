import { describe, expect, it } from 'vitest';
import audit from '../fixtures/leakage_audit.json';
import { auditLeakage, type LeakageAudit, type LeakageRule } from './leakage';

const rule = (rules: LeakageRule[], id: string): LeakageRule => {
  const found = rules.find((r) => r.id === id);
  if (!found) throw new Error(`missing rule ${id}`);
  return found;
};

describe('leakage rules over data/benchmark/leakage_audit.json', () => {
  const rules = auditLeakage(audit);

  it('agrees with the source flags for column disjointness and partition match', () => {
    expect(rule(rules, 'checks-disjoint').passed).toBe(audit.checks.column_sets_disjoint);
    expect(rule(rules, 'ex-ante-classified').passed).toBe(audit.checks.ex_ante_partition_matches_benchmark);
  });

  it('finds project_id, the join key, in both the ex-ante and ex-post column lists', () => {
    expect(rule(rules, 'checks-disjoint').passed).toBe(false);
    expect(rule(rules, 'checks-disjoint').detail).toEqual(['project_id']);
  });

  it('finds project_registration_date, which is classified as other, not ex-ante', () => {
    expect(rule(rules, 'ex-ante-classified').detail).toEqual(['project_registration_date']);
  });

  it('passes the partition-level check that no field is in both groups', () => {
    expect(rule(rules, 'partition-disjoint').passed).toBe(true);
  });

  it('finds no forbidden ex-post name among the ex-ante fields', () => {
    expect(rule(rules, 'forbidden-absent').passed).toBe(true);
  });

  it('finds every classified field documented with a rationale', () => {
    expect(rule(rules, 'rationale').passed).toBe(true);
  });

  it('fails the forbidden-name rule when a forbidden name is placed among ex-ante fields', () => {
    const leaked: LeakageAudit = {
      ...audit,
      checks: { ...audit.checks, ex_ante_columns: [...audit.checks.ex_ante_columns, 'p_value'] },
    };
    const result = rule(auditLeakage(leaked), 'forbidden-absent');
    expect(result.passed).toBe(false);
    expect(result.detail).toEqual(['p_value']);
  });
});
