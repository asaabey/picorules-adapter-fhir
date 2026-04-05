import { describe, it, expect } from 'vitest';
import { parse, evaluate } from 'picorules-compiler-js-core';
import { smartFetch } from '../src/smart-fetcher';
import {
  introspectDataRequirements,
  buildFhirSearchUrls,
} from '../src/data-requirements';
import { FhirDataAdapter } from '../src/fhir-data-adapter';
import type { Bundle } from '../src/fhir-types';

// ---------------------------------------------------------------------------
// Mock FHIR responses
// ---------------------------------------------------------------------------

const mockPatient = {
  resourceType: 'Patient',
  id: 'p1',
  gender: 'male',
  birthDate: '1957-05-20',
};

const mockObservationBundle: Bundle = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'Observation',
        id: 'egfr-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '33914-3', display: 'eGFR' }],
        },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 39, unit: 'mL/min/1.73m2' },
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        id: 'hb-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
        },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 118, unit: 'g/L' },
      },
    },
  ],
};

const mockConditionBundle: Bundle = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'Condition',
        id: 'dm-1',
        code: {
          coding: [
            { system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 DM' },
          ],
        },
        subject: { reference: 'Patient/p1' },
        onsetDateTime: '2018-06-01',
      },
    },
    {
      resource: {
        resourceType: 'Condition',
        id: 'htn-1',
        code: {
          coding: [
            { system: 'http://hl7.org/fhir/sid/icd-10', code: 'I10', display: 'HTN' },
          ],
        },
        subject: { reference: 'Patient/p1' },
        onsetDateTime: '2020-03-15',
      },
    },
  ],
};

const mockMedBundle: Bundle = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'MedicationRequest',
        id: 'med-acei',
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
          coding: [
            { system: 'http://www.whocc.no/atc', code: 'C09AA', display: 'ACEi' },
          ],
        },
        subject: { reference: 'Patient/p1' },
        authoredOn: '2020-06-01',
      },
    },
  ],
};

/** Mock fetch function that returns appropriate data based on URL. */
function createMockFetch() {
  const calls: string[] = [];

  const fetchFn = async (url: string): Promise<any> => {
    calls.push(url);

    if (url.startsWith('Patient/')) return mockPatient;
    if (url.startsWith('Observation?')) return mockObservationBundle;
    if (url.startsWith('Condition?')) return mockConditionBundle;
    if (url.startsWith('MedicationRequest?')) return mockMedBundle;

    return { resourceType: 'Bundle', type: 'searchset', entry: [] };
  };

  return { fetchFn, calls };
}

// ---------------------------------------------------------------------------
// smartFetch
// ---------------------------------------------------------------------------

describe('smartFetch', () => {
  it('executes queries and assembles a bundle', async () => {
    const { fetchFn, calls } = createMockFetch();

    const parsed = parse([
      {
        name: 'test',
        text: `
          #define_ruleblock(test, { description: "test", is_active: 2 });
          egfr => eadv.lab_bld_egfr.val.last();
          hb => eadv.lab_bld_haemoglobin.val.last();
          dm => eadv.[icd_e11%].dt.min();
          acei => eadv.[rxnc_c09aa%].dt.exists();
          gender => eadv.dmg_gender.val.last();
        `,
        isActive: true,
      },
    ]);

    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'p1');
    const result = await smartFetch(queries, fetchFn);

    // Should have made 4 calls (Patient + Observation + Condition + MedicationRequest)
    expect(calls).toHaveLength(4);
    expect(result.queryCount).toBe(4);

    // Bundle should contain all fetched resources
    // Patient(1) + Observations(2) + Conditions(2) + MedicationRequests(1) = 6
    expect(result.resourceCount).toBe(6);
    expect(result.bundle.entry).toHaveLength(6);

    // Check resource types in bundle
    const types = result.bundle.entry!.map((e) => e.resource.resourceType);
    expect(types).toContain('Patient');
    expect(types).toContain('Observation');
    expect(types).toContain('Condition');
    expect(types).toContain('MedicationRequest');
  });

  it('returns query-level metrics', async () => {
    const { fetchFn } = createMockFetch();

    const queries = [
      { resourceType: 'Patient', path: 'Patient/p1', codeCount: 0 },
      { resourceType: 'Observation', path: 'Observation?patient=p1&code=http://loinc.org|33914-3', codeCount: 1 },
    ];

    const result = await smartFetch(queries, fetchFn);

    expect(result.queryResults).toHaveLength(2);
    expect(result.queryResults[0].resourceType).toBe('Patient');
    expect(result.queryResults[0].resourcesFetched).toBe(1);
    expect(result.queryResults[1].resourceType).toBe('Observation');
    expect(result.queryResults[1].resourcesFetched).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles empty search results gracefully', async () => {
    const fetchFn = async (url: string) => {
      if (url.startsWith('Patient/')) return mockPatient;
      return { resourceType: 'Bundle', type: 'searchset', entry: [] };
    };

    const queries = [
      { resourceType: 'Patient', path: 'Patient/p1', codeCount: 0 },
      { resourceType: 'Observation', path: 'Observation?patient=p1&code=http://loinc.org|99999-9', codeCount: 1 },
    ];

    const result = await smartFetch(queries, fetchFn);
    expect(result.resourceCount).toBe(1); // Only patient
  });
});

// ---------------------------------------------------------------------------
// End-to-end: introspect → smart fetch → evaluate
// ---------------------------------------------------------------------------

describe('end-to-end: smart fetch pipeline', () => {
  it('produces correct evaluation results via smart-fetched bundle', async () => {
    const { fetchFn } = createMockFetch();

    const ruleblockText = `
      #define_ruleblock(test, { description: "test", is_active: 2 });
      egfr_last => eadv.lab_bld_egfr.val.last();
      hb_last => eadv.lab_bld_haemoglobin.val.last();
      dm_fd => eadv.[icd_e11%].dt.min();
      htn_fd => eadv.icd_i10.dt.min();
      on_acei => eadv.[rxnc_c09aa%].dt.exists();
      gender => eadv.dmg_gender.val.last();
      is_ckd : { egfr_last < 60 => 1 }, { => 0 };
      is_anaemic : { gender = 1 and hb_last < 130 => 1 }, { hb_last is not null => 0 }, { => null };
    `;

    const parsed = parse([
      { name: 'test', text: ruleblockText, isActive: true },
    ]);

    // Step 1: Introspect
    const reqs = introspectDataRequirements(parsed);
    expect(reqs.requirements.length).toBeGreaterThan(0);

    // Step 2: Build queries
    const queries = buildFhirSearchUrls(reqs, 'p1');
    expect(queries.length).toBe(4);

    // Step 3: Smart fetch
    const { bundle } = await smartFetch(queries, fetchFn);
    expect(bundle.entry!.length).toBeGreaterThan(0);

    // Step 4: Evaluate using the smart-fetched bundle
    const adapter = new FhirDataAdapter(bundle);
    const result = evaluate(parsed[0] as any, adapter);

    // Verify clinical outputs
    expect(result.egfr_last).toBe(39);
    expect(result.hb_last).toBe(118);
    expect(result.on_acei).toBe(1);
    expect(result.gender).toBe(1); // male
    expect(result.is_ckd).toBe(1); // eGFR 39 < 60
    expect(result.is_anaemic).toBe(1); // male + Hb 118 < 130

    // DM and HTN dates
    expect(result.dm_fd).toBeInstanceOf(Date);
    expect(result.htn_fd).toBeInstanceOf(Date);
  });

  it('smart-fetched bundle produces identical results to full bundle', async () => {
    const ruleblockText = `
      #define_ruleblock(compare, { description: "test", is_active: 2 });
      egfr_last => eadv.lab_bld_egfr.val.last();
      hb_last => eadv.lab_bld_haemoglobin.val.last();
      dm_fd => eadv.[icd_e11%].dt.min();
      on_acei => eadv.[rxnc_c09aa%].dt.exists();
      gender => eadv.dmg_gender.val.last();
    `;

    const parsed = parse([
      { name: 'compare', text: ruleblockText, isActive: true },
    ]);

    // Full bundle (what we'd get from fetching everything)
    const fullBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: mockPatient as any },
        ...mockObservationBundle.entry!,
        ...mockConditionBundle.entry!,
        ...mockMedBundle.entry!,
        // Extra resources that the rules DON'T need
        {
          resource: {
            resourceType: 'Observation',
            id: 'extra-lipid',
            status: 'final',
            code: {
              coding: [{ system: 'http://loinc.org', code: '2093-3', display: 'Total Cholesterol' }],
            },
            effectiveDateTime: '2025-01-10',
            valueQuantity: { value: 5.2, unit: 'mmol/L' },
          },
        },
      ],
    };

    // Smart-fetched bundle (only what the rules need)
    const { fetchFn } = createMockFetch();
    const reqs = introspectDataRequirements(parsed);
    const queries = buildFhirSearchUrls(reqs, 'p1');
    const { bundle: smartBundle } = await smartFetch(queries, fetchFn);

    // Evaluate both
    const fullResult = evaluate(parsed[0] as any, new FhirDataAdapter(fullBundle));
    const smartResult = evaluate(parsed[0] as any, new FhirDataAdapter(smartBundle));

    // Results should be identical
    expect(smartResult.egfr_last).toBe(fullResult.egfr_last);
    expect(smartResult.hb_last).toBe(fullResult.hb_last);
    expect(smartResult.on_acei).toBe(fullResult.on_acei);
    expect(smartResult.gender).toBe(fullResult.gender);

    // But smart bundle is smaller
    expect(smartBundle.entry!.length).toBeLessThanOrEqual(fullBundle.entry!.length);
  });
});
