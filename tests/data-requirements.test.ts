import { describe, it, expect } from 'vitest';
import { parse } from 'picorules-compiler-js-core';
import {
  extractAttributes,
  introspectDataRequirements,
  buildFhirSearchUrls,
  generateCdsHooksPrefetch,
} from '../src/data-requirements';
import { CODE_SYSTEMS } from '../src/terminology-map';

// ---------------------------------------------------------------------------
// Helper: parse a set of ruleblocks from inline text
// ---------------------------------------------------------------------------

function parseRules(rules: Array<{ name: string; text: string }>) {
  return parse(rules.map((r) => ({ ...r, isActive: true })));
}

// ---------------------------------------------------------------------------
// extractAttributes
// ---------------------------------------------------------------------------

describe('extractAttributes', () => {
  it('extracts single attributes from FETCH statements', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          hb => eadv.lab_bld_haemoglobin.val.last();
          egfr => eadv.lab_bld_egfr.val.last();
        `,
      },
    ]);

    const attrs = extractAttributes(parsed);
    expect(attrs).toContain('lab_bld_haemoglobin');
    expect(attrs).toContain('lab_bld_egfr');
    expect(attrs.size).toBe(2);
  });

  it('extracts multi-attribute brackets', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          ami => eadv.[icd_i21%,icd_i22%].dt.min();
        `,
      },
    ]);

    const attrs = extractAttributes(parsed);
    expect(attrs).toContain('icd_i21%');
    expect(attrs).toContain('icd_i22%');
  });

  it('extracts wildcard attributes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          dm => eadv.[icd_e11%].dt.min();
        `,
      },
    ]);

    const attrs = extractAttributes(parsed);
    expect(attrs).toContain('icd_e11%');
  });

  it('deduplicates across ruleblocks', () => {
    const parsed = parseRules([
      {
        name: 'rb1',
        text: `
          #define_ruleblock(rb1, { description: "test", is_active: 2 });
          a => eadv.lab_bld_egfr.val.last();
        `,
      },
      {
        name: 'rb2',
        text: `
          #define_ruleblock(rb2, { description: "test", is_active: 2 });
          b => eadv.lab_bld_egfr.val.first();
          c => eadv.lab_bld_hba1c.val.last();
        `,
      },
    ]);

    const attrs = extractAttributes(parsed);
    expect(attrs.size).toBe(2); // egfr + hba1c (egfr deduplicated)
  });

  it('ignores COMPUTE and BIND statements', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          hb => eadv.lab_bld_haemoglobin.val.last();
          is_low : { hb < 120 => 1 }, { => 0 };
        `,
      },
    ]);

    const attrs = extractAttributes(parsed);
    expect(attrs.size).toBe(1);
    expect(attrs).toContain('lab_bld_haemoglobin');
  });
});

// ---------------------------------------------------------------------------
// introspectDataRequirements
// ---------------------------------------------------------------------------

describe('introspectDataRequirements', () => {
  it('resolves LOINC lab codes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          egfr => eadv.lab_bld_egfr.val.last();
          hb => eadv.lab_bld_haemoglobin.val.last();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);

    expect(reqs.requirements).toHaveLength(2);
    expect(reqs.needsPatient).toBe(false);
    expect(reqs.resourceTypes).toContain('Observation');
    expect(reqs.unmappedAttributes).toHaveLength(0);

    const egfr = reqs.requirements.find((r) => r.code === '33914-3');
    expect(egfr).toBeDefined();
    expect(egfr!.system).toBe(CODE_SYSTEMS.LOINC);
    expect(egfr!.resourceType).toBe('Observation');
    expect(egfr!.isWildcard).toBe(false);
  });

  it('resolves ICD-10 codes with wildcards', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          dm => eadv.[icd_e11%].dt.min();
          htn => eadv.icd_i10.dt.min();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);

    const dm = reqs.requirements.find((r) => r.code === 'E11');
    expect(dm).toBeDefined();
    expect(dm!.system).toBe(CODE_SYSTEMS.ICD10);
    expect(dm!.resourceType).toBe('Condition');
    expect(dm!.isWildcard).toBe(true);

    const htn = reqs.requirements.find((r) => r.code === 'I10');
    expect(htn).toBeDefined();
    expect(htn!.isWildcard).toBe(false);
  });

  it('resolves ATC medication codes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          acei => eadv.[rxnc_c09aa%].dt.exists();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);

    const acei = reqs.requirements.find((r) => r.code === 'C09AA');
    expect(acei).toBeDefined();
    expect(acei!.system).toBe(CODE_SYSTEMS.ATC);
    expect(acei!.resourceType).toBe('MedicationRequest');
    expect(acei!.isWildcard).toBe(true);
  });

  it('detects Patient demographics', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          gender => eadv.dmg_gender.val.last();
          dob => eadv.dmg_dob.dt.max();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    expect(reqs.needsPatient).toBe(true);
    // Patient demographics don't generate code requirements
    expect(reqs.requirements.filter((r) => r.resourceType === 'Patient')).toHaveLength(0);
  });

  it('tracks unmapped attributes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          x => eadv.totally_unknown_thing.val.last();
          egfr => eadv.lab_bld_egfr.val.last();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    expect(reqs.unmappedAttributes).toContain('totally_unknown_thing');
    expect(reqs.requirements).toHaveLength(1); // only egfr
  });

  it('deduplicates requirements with same code from different attributes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          hb1 => eadv.lab_bld_haemoglobin.val.last();
          hb2 => eadv.lab_bld_hb.val.first();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    // Both map to LOINC 718-7 — should deduplicate
    const hbReqs = reqs.requirements.filter((r) => r.code === '718-7');
    expect(hbReqs).toHaveLength(1);
    expect(hbReqs[0].sourceAttributes).toContain('lab_bld_haemoglobin');
    expect(hbReqs[0].sourceAttributes).toContain('lab_bld_hb');
  });

  it('handles a realistic CKD ruleblock set', () => {
    const parsed = parseRules([
      {
        name: 'ckd_metrics',
        text: `
          #define_ruleblock(ckd_metrics, { description: "CKD metrics", is_active: 2 });
          egfr_l => eadv.lab_bld_egfr._.lastdv();
          acr_l => eadv.lab_ua_acr._.lastdv();
          hb => eadv.lab_bld_haemoglobin.val.last();
          bp => eadv.obs_bp_systolic.val.last();
          dm => eadv.[icd_e11%].dt.min();
          htn => eadv.icd_i10.dt.min();
          acei => eadv.[rxnc_c09aa%].dt.exists();
          arb => eadv.[rxnc_c09ca%].dt.exists();
          gender => eadv.dmg_gender.val.last();
          dob => eadv.dmg_dob.dt.max();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);

    expect(reqs.needsPatient).toBe(true);
    expect(reqs.resourceTypes).toContain('Observation');
    expect(reqs.resourceTypes).toContain('Condition');
    expect(reqs.resourceTypes).toContain('MedicationRequest');
    expect(reqs.unmappedAttributes).toHaveLength(0);

    // 4 LOINC + 2 ICD + 2 ATC = 8 requirements
    expect(reqs.requirements.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// buildFhirSearchUrls
// ---------------------------------------------------------------------------

describe('buildFhirSearchUrls', () => {
  it('builds Patient read URL', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          gender => eadv.dmg_gender.val.last();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'patient-123');

    const patientQuery = queries.find((q) => q.resourceType === 'Patient');
    expect(patientQuery).toBeDefined();
    expect(patientQuery!.path).toBe('Patient/patient-123');
  });

  it('builds Observation query with comma-separated LOINC codes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          egfr => eadv.lab_bld_egfr.val.last();
          hb => eadv.lab_bld_haemoglobin.val.last();
          hba1c => eadv.lab_bld_hba1c.val.last();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'p1');

    const obsQuery = queries.find((q) => q.resourceType === 'Observation');
    expect(obsQuery).toBeDefined();
    expect(obsQuery!.path).toContain('Observation?patient=p1&code=');
    expect(obsQuery!.path).toContain('http://loinc.org|33914-3');
    expect(obsQuery!.path).toContain('http://loinc.org|718-7');
    expect(obsQuery!.path).toContain('http://loinc.org|4548-4');
    expect(obsQuery!.codeCount).toBe(3);
  });

  it('fetches all Conditions when wildcards are present', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          dm => eadv.[icd_e11%].dt.min();
          htn => eadv.icd_i10.dt.min();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'p1');

    const condQuery = queries.find((q) => q.resourceType === 'Condition');
    expect(condQuery).toBeDefined();
    // Should fetch all conditions (wildcard strategy)
    expect(condQuery!.path).toBe('Condition?patient=p1');
  });

  it('builds MedicationRequest query with ATC codes', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          acei => eadv.[rxnc_c09aa%].dt.exists();
          statin => eadv.[rxnc_c10aa%].dt.exists();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'p1');

    const medQuery = queries.find((q) => q.resourceType === 'MedicationRequest');
    expect(medQuery).toBeDefined();
    expect(medQuery!.path).toContain('MedicationRequest?patient=p1&code=');
    expect(medQuery!.path).toContain('http://www.whocc.no/atc|C09AA');
    expect(medQuery!.path).toContain('http://www.whocc.no/atc|C10AA');
  });

  it('produces minimal queries for a full clinical scenario', () => {
    const parsed = parseRules([
      {
        name: 'full',
        text: `
          #define_ruleblock(full, { description: "test", is_active: 2 });
          egfr => eadv.lab_bld_egfr.val.last();
          hb => eadv.lab_bld_haemoglobin.val.last();
          hba1c => eadv.lab_bld_hba1c.val.last();
          bp => eadv.obs_bp_systolic.val.last();
          acr => eadv.lab_ua_acr.val.last();
          dm => eadv.[icd_e11%].dt.min();
          htn => eadv.icd_i10.dt.min();
          ckd => eadv.[icd_n18%].dt.min();
          acei => eadv.[rxnc_c09aa%].dt.exists();
          statin => eadv.[rxnc_c10aa%].dt.exists();
          gender => eadv.dmg_gender.val.last();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'test-patient');

    // Should produce exactly 4 queries:
    // 1. Patient read
    // 2. Observation (5 LOINC codes)
    // 3. Condition (all — wildcard strategy)
    // 4. MedicationRequest (2 ATC codes)
    expect(queries).toHaveLength(4);
    expect(queries.map((q) => q.resourceType).sort()).toEqual([
      'Condition',
      'MedicationRequest',
      'Observation',
      'Patient',
    ]);
  });
});

// ---------------------------------------------------------------------------
// generateCdsHooksPrefetch
// ---------------------------------------------------------------------------

describe('generateCdsHooksPrefetch', () => {
  it('generates CDS Hooks prefetch templates', () => {
    const parsed = parseRules([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          egfr => eadv.lab_bld_egfr.val.last();
          dm => eadv.[icd_e11%].dt.min();
          acei => eadv.[rxnc_c09aa%].dt.exists();
          gender => eadv.dmg_gender.val.last();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const prefetch = generateCdsHooksPrefetch(reqs);

    expect(prefetch).toHaveProperty('patient');
    expect(prefetch.patient).toBe('Patient/{{context.patientId}}');

    expect(prefetch).toHaveProperty('observations');
    expect(prefetch.observations).toContain('Observation?patient={{context.patientId}}');
    expect(prefetch.observations).toContain('http://loinc.org|33914-3');

    expect(prefetch).toHaveProperty('conditions');
    expect(prefetch.conditions).toBe('Condition?patient={{context.patientId}}');

    expect(prefetch).toHaveProperty('medicationrequests');
    expect(prefetch.medicationrequests).toContain('http://www.whocc.no/atc|C09AA');
  });
});

// ---------------------------------------------------------------------------
// Integration: full reference ruleblock introspection
// ---------------------------------------------------------------------------

describe('reference ruleblock introspection', () => {
  it('introspects a multi-ruleblock CKD scenario', () => {
    const parsed = parseRules([
      {
        name: 'dmg',
        text: `
          #define_ruleblock(dmg, { description: "demographics", is_active: 2 });
          dob => eadv.dmg_dob.dt.max();
          gender => eadv.dmg_gender.val.last();
          age : { dob < sysdate => round(((sysdate-dob)/365.25),0) };
        `,
      },
      {
        name: 'ckd_egfr_metrics',
        text: `
          #define_ruleblock(ckd_egfr_metrics, { description: "egfr metrics", is_active: 2 });
          egfr_l => eadv.lab_bld_egfr._.lastdv();
          egfr_l1 => eadv.lab_bld_egfr._.lastdv();
          egfr_f => eadv.lab_bld_egfr._.firstdv();
          egfr_slope => eadv.lab_bld_egfr.val.regr_slope();
          egfr_n => eadv.lab_bld_egfr.dt.count();
        `,
      },
      {
        name: 'ckd',
        text: `
          #define_ruleblock(ckd, { description: "CKD staging", is_active: 2 });
          egfr_l_val => rout_ckd_egfr_metrics.egfr_l_val.val.bind();
          acr_l => eadv.lab_ua_acr._.lastdv();
          htn => eadv.icd_i10.dt.min();
          dm => eadv.[icd_e11%].dt.min();
          ckd_stage : { egfr_l_val >= 90 => 1 }, { egfr_l_val >= 60 => 2 }, { => 3 };
        `,
      },
      {
        name: 'rx_cv',
        text: `
          #define_ruleblock(rx_cv, { description: "CV meds", is_active: 2 });
          acei => eadv.[rxnc_c09aa%].dt.exists();
          arb => eadv.[rxnc_c09ca%].dt.exists();
          statin => eadv.[rxnc_c10aa%].dt.exists();
          bb => eadv.[rxnc_c07%].dt.exists();
        `,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);

    // Demographics needed
    expect(reqs.needsPatient).toBe(true);

    // All three clinical resource types
    expect(reqs.resourceTypes).toContain('Observation');
    expect(reqs.resourceTypes).toContain('Condition');
    expect(reqs.resourceTypes).toContain('MedicationRequest');

    // egfr (deduped) + ACR = 2 Observation codes
    const obsCodes = reqs.requirements.filter((r) => r.resourceType === 'Observation');
    expect(obsCodes.length).toBe(2);

    // I10 + E11 = 2 Condition codes
    const condCodes = reqs.requirements.filter((r) => r.resourceType === 'Condition');
    expect(condCodes.length).toBe(2);

    // 4 ATC medication codes
    const medCodes = reqs.requirements.filter((r) => r.resourceType === 'MedicationRequest');
    expect(medCodes.length).toBe(4);

    // Build queries — should be 4 total
    const queries = buildFhirSearchUrls(reqs, 'patient-1');
    expect(queries).toHaveLength(4);
  });
});
