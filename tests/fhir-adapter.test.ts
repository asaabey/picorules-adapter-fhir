import { describe, it, expect } from 'vitest';
import { parse, evaluate } from 'picorules-compiler-js-core';
import { FhirDataAdapter } from '../src/fhir-data-adapter';
import { resolveAttribute, codeMatchesPattern, CODE_SYSTEMS } from '../src/terminology-map';
import type { Bundle } from '../src/fhir-types';

// ---------------------------------------------------------------------------
// Terminology map tests
// ---------------------------------------------------------------------------

describe('resolveAttribute', () => {
  it('auto-derives ICD-10 codes', () => {
    const entry = resolveAttribute('icd_e11');
    expect(entry).not.toBeNull();
    expect(entry!.system).toBe(CODE_SYSTEMS.ICD10);
    expect(entry!.code).toBe('E11');
    expect(entry!.resourceType).toBe('Condition');
  });

  it('auto-derives ICD-10 with subcode', () => {
    const entry = resolveAttribute('icd_n18_3');
    expect(entry).not.toBeNull();
    expect(entry!.code).toBe('N18.3');
  });

  it('auto-derives ICPC-2 codes', () => {
    const entry = resolveAttribute('icpc_k86001');
    expect(entry).not.toBeNull();
    expect(entry!.system).toBe(CODE_SYSTEMS.ICPC2);
    expect(entry!.code).toBe('K86001');
    expect(entry!.resourceType).toBe('Condition');
  });

  it('auto-derives ATC codes', () => {
    const entry = resolveAttribute('rxnc_a10ba');
    expect(entry).not.toBeNull();
    expect(entry!.system).toBe(CODE_SYSTEMS.ATC);
    expect(entry!.code).toBe('A10BA');
    expect(entry!.resourceType).toBe('MedicationRequest');
  });

  it('resolves LOINC for lab attributes', () => {
    const entry = resolveAttribute('lab_bld_haemoglobin');
    expect(entry).not.toBeNull();
    expect(entry!.system).toBe(CODE_SYSTEMS.LOINC);
    expect(entry!.code).toBe('718-7');
    expect(entry!.resourceType).toBe('Observation');
  });

  it('resolves LOINC for vitals', () => {
    const entry = resolveAttribute('obs_bp_systolic');
    expect(entry).not.toBeNull();
    expect(entry!.system).toBe(CODE_SYSTEMS.LOINC);
    expect(entry!.code).toBe('8480-6');
  });

  it('resolves demographics', () => {
    const gender = resolveAttribute('dmg_gender');
    expect(gender).not.toBeNull();
    expect(gender!.resourceType).toBe('Patient');
    expect(gender!.valuePath).toBe('gender');

    const dob = resolveAttribute('dmg_dob');
    expect(dob).not.toBeNull();
    expect(dob!.valuePath).toBe('birthDate');
  });

  it('returns null for unknown attributes', () => {
    expect(resolveAttribute('totally_unknown_xyz')).toBeNull();
  });

  it('respects overrides', () => {
    const overrides = {
      'my_custom_lab': {
        system: CODE_SYSTEMS.LOINC,
        code: '99999-9',
        resourceType: 'Observation' as const,
      },
    };
    const entry = resolveAttribute('my_custom_lab', overrides);
    expect(entry).not.toBeNull();
    expect(entry!.code).toBe('99999-9');
  });
});

describe('codeMatchesPattern', () => {
  it('matches exact codes', () => {
    expect(codeMatchesPattern('E11', 'E11')).toBe(true);
    expect(codeMatchesPattern('E11', 'E12')).toBe(false);
  });

  it('matches wildcard patterns', () => {
    expect(codeMatchesPattern('E11', 'E11%')).toBe(true);
    expect(codeMatchesPattern('E11.0', 'E11%')).toBe(true);
    expect(codeMatchesPattern('E11.9', 'E11%')).toBe(true);
    expect(codeMatchesPattern('E12', 'E11%')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(codeMatchesPattern('e11', 'E11')).toBe(true);
    expect(codeMatchesPattern('E11', 'e11%')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sample FHIR Bundle: 68yo male with CKD, HTN, prostate cancer
// ---------------------------------------------------------------------------

const sampleBundle: Bundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    // Patient
    {
      resource: {
        resourceType: 'Patient',
        id: 'patient-1',
        gender: 'male',
        birthDate: '1957-05-20',
      },
    },
    // eGFR observations (declining)
    ...[
      { date: '2023-01-15', value: 52 },
      { date: '2023-07-10', value: 48 },
      { date: '2024-01-20', value: 45 },
      { date: '2024-07-15', value: 42 },
      { date: '2025-01-10', value: 39 },
    ].map(obs => ({
      resource: {
        resourceType: 'Observation' as const,
        id: `egfr-${obs.date}`,
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '33914-3', display: 'eGFR' }],
        },
        subject: { reference: 'Patient/patient-1' },
        effectiveDateTime: obs.date,
        valueQuantity: { value: obs.value, unit: 'mL/min/1.73m2', system: 'http://unitsofmeasure.org', code: 'mL/min/{1.73_m2}' },
      },
    })),
    // Haemoglobin
    ...[
      { date: '2024-01-20', value: 125 },
      { date: '2025-01-10', value: 118 },
    ].map(obs => ({
      resource: {
        resourceType: 'Observation' as const,
        id: `hb-${obs.date}`,
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
        },
        subject: { reference: 'Patient/patient-1' },
        effectiveDateTime: obs.date,
        valueQuantity: { value: obs.value, unit: 'g/L' },
      },
    })),
    // Blood pressure
    {
      resource: {
        resourceType: 'Observation',
        id: 'bp-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic BP' }],
        },
        subject: { reference: 'Patient/patient-1' },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 145, unit: 'mmHg' },
      },
    },
    // Height & Weight
    {
      resource: {
        resourceType: 'Observation',
        id: 'height-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '8302-2', display: 'Height' }],
        },
        effectiveDateTime: '2024-01-20',
        valueQuantity: { value: 175, unit: 'cm' },
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        id: 'weight-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Weight' }],
        },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 80, unit: 'kg' },
      },
    },
    // Cholesterol
    {
      resource: {
        resourceType: 'Observation',
        id: 'tc-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '2093-3', display: 'Total Cholesterol' }],
        },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 5.2, unit: 'mmol/L' },
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        id: 'hdl-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '2085-9', display: 'HDL' }],
        },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 1.3, unit: 'mmol/L' },
      },
    },
    // ACR (urine)
    ...[
      { date: '2024-01-20', value: 25 },
      { date: '2024-07-15', value: 35 },
      { date: '2025-01-10', value: 45 },
    ].map(obs => ({
      resource: {
        resourceType: 'Observation' as const,
        id: `acr-${obs.date}`,
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '9318-7', display: 'ACR' }],
        },
        effectiveDateTime: obs.date,
        valueQuantity: { value: obs.value, unit: 'mg/mmol' },
      },
    })),
    // Conditions: Hypertension (ICD I10)
    {
      resource: {
        resourceType: 'Condition',
        id: 'htn-1',
        code: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I10', display: 'Essential hypertension' }],
        },
        subject: { reference: 'Patient/patient-1' },
        onsetDateTime: '2020-03-15',
      },
    },
    // Conditions: Prostate cancer (ICD C61)
    {
      resource: {
        resourceType: 'Condition',
        id: 'prostate-1',
        code: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'C61', display: 'Prostate cancer' }],
        },
        subject: { reference: 'Patient/patient-1' },
        onsetDateTime: '2023-09-01',
      },
    },
    // Conditions: Type 2 DM (ICD E11.9)
    {
      resource: {
        resourceType: 'Condition',
        id: 'dm-1',
        code: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 diabetes' }],
        },
        subject: { reference: 'Patient/patient-1' },
        onsetDateTime: '2018-06-01',
      },
    },
    // Medications: ACE inhibitor (ATC C09AA)
    {
      resource: {
        resourceType: 'MedicationRequest',
        id: 'med-acei',
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
          coding: [{ system: 'http://www.whocc.no/atc', code: 'C09AA', display: 'ACE inhibitors' }],
        },
        subject: { reference: 'Patient/patient-1' },
        authoredOn: '2020-06-01',
      },
    },
    // Medications: CCB (ATC C08CA)
    {
      resource: {
        resourceType: 'MedicationRequest',
        id: 'med-ccb',
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
          coding: [{ system: 'http://www.whocc.no/atc', code: 'C08CA', display: 'CCB' }],
        },
        subject: { reference: 'Patient/patient-1' },
        authoredOn: '2022-01-01',
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// FhirDataAdapter basic tests
// ---------------------------------------------------------------------------

describe('FhirDataAdapter', () => {
  const adapter = new FhirDataAdapter(sampleBundle);

  it('retrieves Observations by LOINC code (exact match)', () => {
    const records = adapter.getRecords(['lab_bld_haemoglobin']);
    expect(records).toHaveLength(2);
    expect(records.map(r => r.val)).toContain(125);
    expect(records.map(r => r.val)).toContain(118);
  });

  it('retrieves Observations by LOINC code (eGFR)', () => {
    const records = adapter.getRecords(['lab_bld_egfr']);
    expect(records).toHaveLength(5);
    expect(records.map(r => r.val)).toContain(39);
    expect(records.map(r => r.val)).toContain(52);
  });

  it('retrieves Conditions by ICD-10 wildcard', () => {
    const records = adapter.getRecords(['icd_e11%']);
    expect(records).toHaveLength(1);
    expect(records[0].val).toBe(1);
    expect(records[0].dt).toBeInstanceOf(Date);
  });

  it('retrieves Conditions by exact ICD-10 code', () => {
    const records = adapter.getRecords(['icd_c61']);
    expect(records).toHaveLength(1); // prostate cancer
  });

  it('retrieves MedicationRequests by ATC code', () => {
    const records = adapter.getRecords(['rxnc_c09aa']);
    expect(records).toHaveLength(1); // ACE inhibitor
    expect(records[0].val).toBe(1);
  });

  it('retrieves multiple attribute types in one call', () => {
    const records = adapter.getRecords(['lab_bld_haemoglobin', 'lab_bld_egfr']);
    expect(records).toHaveLength(7); // 2 Hb + 5 eGFR
  });

  it('retrieves Patient demographics (gender)', () => {
    const records = adapter.getRecords(['dmg_gender']);
    expect(records).toHaveLength(1);
    expect(records[0].val).toBe(1); // male
  });

  it('retrieves Patient demographics (DOB)', () => {
    const records = adapter.getRecords(['dmg_dob']);
    expect(records).toHaveLength(1);
    expect(records[0].dt).toBeInstanceOf(Date);
    expect(records[0].dt!.getFullYear()).toBe(1957);
  });

  it('returns empty for unknown attributes', () => {
    const records = adapter.getRecords(['totally_unknown_xyz']);
    expect(records).toHaveLength(0);
  });

  it('handles wildcard ICD matching', () => {
    // icd_i% should match I10 (hypertension)
    const records = adapter.getRecords(['icd_i%']);
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: Parse .prb → Evaluate against FHIR Bundle
// ---------------------------------------------------------------------------

describe('end-to-end: picorules on FHIR', () => {
  const adapter = new FhirDataAdapter(sampleBundle);

  it('evaluates a simple anaemia check against FHIR data', () => {
    const parsed = parse([{
      name: 'anaemia',
      text: `
        #define_ruleblock(anaemia, { description: "test", is_active: 2 });
        hb_last => eadv.lab_bld_haemoglobin.val.last();
        is_anaemic : { hb_last < 120 => 1 }, { => 0 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.hb_last).toBe(118);
    expect(result.is_anaemic).toBe(1); // 118 < 120
  });

  it('evaluates prostate cancer detection from FHIR Conditions', () => {
    const parsed = parse([{
      name: 'ca_prostate',
      text: `
        #define_ruleblock(ca_prostate, { description: "test", is_active: 2 });
        icd_fd => eadv.[icd_c61%].dt.first();
        [[rb_id]] : { icd_fd!? => 1 }, { => 0 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.icd_fd).toBeInstanceOf(Date);
    expect((result.icd_fd as Date).toISOString().slice(0, 10)).toBe('2023-09-01');
    expect(result.ca_prostate).toBe(1);
  });

  it('evaluates BMI from FHIR Observations', () => {
    const parsed = parse([{
      name: 'obesity',
      text: `
        #define_ruleblock(obesity, { description: "test", is_active: 2 });
        ht => eadv.obs_height.val.lastdv();
        wt => eadv.obs_weight.val.lastdv();
        ht_err : { ht_val < 50 or ht_val > 300 => 1 }, { => 0 };
        wt_err : { wt_val < 10 or wt_val > 300 => 1 }, { => 0 };
        bmi : { ht_err = 0 and wt_err = 0 => round(wt_val / power(ht_val / 100, 2), 1) };
        is_obese : { bmi > 30 => 1 }, { => 0 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.ht_val).toBe(175);
    expect(result.wt_val).toBe(80);
    expect(result.bmi).toBeCloseTo(26.1, 1);
    expect(result.is_obese).toBe(0);
  });

  it('evaluates diabetes detection from ICD E11 wildcard', () => {
    const parsed = parse([{
      name: 'dm',
      text: `
        #define_ruleblock(dm, { description: "test", is_active: 2 });
        dm_icd_fd => eadv.[icd_e11%].dt.min();
        has_dm : { dm_icd_fd!? => 1 }, { => 0 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.dm_icd_fd).toBeInstanceOf(Date);
    expect(result.has_dm).toBe(1);
  });

  it('evaluates medication detection from ATC codes', () => {
    const parsed = parse([{
      name: 'meds',
      text: `
        #define_ruleblock(meds, { description: "test", is_active: 2 });
        acei => eadv.[rxnc_c09aa%].dt.exists();
        arb  => eadv.[rxnc_c09ca%].dt.exists();
        ccb  => eadv.[rxnc_c08ca%].dt.exists();
        on_raas : { acei = 1 or arb = 1 => 1 }, { => 0 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.acei).toBe(1);
    expect(result.arb).toBe(0);
    expect(result.ccb).toBe(1);
    expect(result.on_raas).toBe(1);
  });

  it('evaluates eGFR trend from FHIR Observations', () => {
    const parsed = parse([{
      name: 'egfr_trend',
      text: `
        #define_ruleblock(egfr_trend, { description: "test", is_active: 2 });
        egfr_last => eadv.lab_bld_egfr.val.last();
        egfr_count => eadv.lab_bld_egfr.dt.count();
        egfr_slope => eadv.lab_bld_egfr.val.regr_slope();
        ckd_stage :
          { egfr_last >= 90 => 1 },
          { egfr_last >= 60 => 2 },
          { egfr_last >= 45 => 3 },
          { egfr_last >= 30 => 4 },
          { egfr_last >= 15 => 5 },
          { => 0 };
        declining : { egfr_slope < 0 => 1 }, { => 0 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.egfr_last).toBe(39);
    expect(result.egfr_count).toBe(5);
    expect(result.ckd_stage).toBe(4);  // 39 >= 30 but < 45
    expect(result.declining).toBe(1);  // negative slope
    expect(typeof result.egfr_slope).toBe('number');
    expect(result.egfr_slope as number).toBeLessThan(0);
  });

  it('evaluates ACR staging from FHIR urine labs', () => {
    const parsed = parse([{
      name: 'acr',
      text: `
        #define_ruleblock(acr, { description: "test", is_active: 2 });
        acr_last => eadv.lab_ua_acr.val.last();
        acr_count => eadv.lab_ua_acr.dt.count();
        acr_stage :
          { acr_last < 3 => 1 },
          { acr_last < 30 => 2 },
          { acr_last < 300 => 3 },
          { => 4 };
      `,
      isActive: true,
    }]);

    const result = evaluate(parsed[0] as any, adapter);
    expect(result.acr_last).toBe(45);
    expect(result.acr_count).toBe(3);
    expect(result.acr_stage).toBe(3);  // 45 >= 30, < 300 → A3
  });
});
