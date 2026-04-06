import { describe, it, expect } from 'vitest';
import { parse, evaluate } from 'picorules-compiler-js-core';
import { FhirDataAdapter } from '../src/fhir-data-adapter';
import {
  FhirOutputMapper,
  PicoTypeCode,
  OutputCategory,
  type OutputAttributeMeta,
  type GuidanceResponse,
  type RiskAssessment,
  type DetectedIssue,
  type Parameters,
} from '../src/fhir-output-mapper';
import type { Bundle, Observation } from '../src/fhir-types';

// ---------------------------------------------------------------------------
// Sample FHIR Bundle: CKD patient (reuse from adapter tests)
// ---------------------------------------------------------------------------

const patientBundle: Bundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Patient',
        id: 'patient-42',
        gender: 'male',
        birthDate: '1957-05-20',
      },
    },
    // eGFR observations (declining)
    ...[
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
        subject: { reference: 'Patient/patient-42' },
        effectiveDateTime: obs.date,
        valueQuantity: { value: obs.value, unit: 'mL/min/1.73m2' },
      },
    })),
    // Haemoglobin
    {
      resource: {
        resourceType: 'Observation',
        id: 'hb-1',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
        },
        subject: { reference: 'Patient/patient-42' },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 108, unit: 'g/L' },
      },
    },
    // Hypertension
    {
      resource: {
        resourceType: 'Condition',
        id: 'htn-1',
        code: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I10', display: 'Essential hypertension' }],
        },
        subject: { reference: 'Patient/patient-42' },
        onsetDateTime: '2020-03-15',
      },
    },
    // Type 2 Diabetes
    {
      resource: {
        resourceType: 'Condition',
        id: 'dm-1',
        code: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 diabetes' }],
        },
        subject: { reference: 'Patient/patient-42' },
        onsetDateTime: '2018-06-01',
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Ruleblock + attribute metadata
// ---------------------------------------------------------------------------

const ckdRuleblock = `
  #define_ruleblock(ckd_assessment, { description: "CKD staging and management flags", is_active: 2 });

  egfr_last => eadv.lab_bld_egfr.val.last();
  hb_last => eadv.lab_bld_haemoglobin.val.last();
  dm_dx => eadv.[icd_e11%].dt.min();
  htn_dx => eadv.[icd_i10%].dt.min();
  egfr_slope => eadv.lab_bld_egfr.val.regr_slope();

  ckd_stage :
    { egfr_last >= 90 => 1 },
    { egfr_last >= 60 => 2 },
    { egfr_last >= 45 => 3 },
    { egfr_last >= 30 => 4 },
    { egfr_last >= 15 => 5 },
    { => 0 };

  is_anaemic : { hb_last!? and hb_last < 120 => 1 }, { => 0 };
  needs_epo : { ckd_stage >= 3 and hb_last < 100 => 1 }, { => 0 };
  declining : { egfr_slope < 0 => 1 }, { => 0 };
  has_dm : { dm_dx!? => 1 }, { => 0 };
  has_htn : { htn_dx!? => 1 }, { => 0 };

  cvd_risk :
    { ckd_stage >= 4 => 4 },
    { ckd_stage >= 3 and has_dm = 1 => 3 },
    { ckd_stage >= 3 and has_htn = 1 => 3 },
    { has_dm = 1 or has_htn = 1 => 2 },
    { => 1 };
`;

const attributeMetadata: OutputAttributeMeta[] = [
  {
    variable: 'egfr_last',
    label: 'eGFR (most recent)',
    type: PicoTypeCode.NUMERIC,
    isReportable: true,
    unit: 'mL/min/1.73m2',
    unitCode: 'mL/min/{1.73_m2}',
    code: { system: 'http://loinc.org', code: '33914-3', display: 'eGFR' },
  },
  {
    variable: 'hb_last',
    label: 'Haemoglobin (most recent)',
    type: PicoTypeCode.NUMERIC,
    isReportable: true,
    unit: 'g/L',
    unitCode: 'g/L',
    code: { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' },
  },
  {
    variable: 'ckd_stage',
    label: 'CKD Stage (1-5)',
    type: PicoTypeCode.NUMERIC,
    isReportable: true,
  },
  {
    variable: 'is_anaemic',
    label: 'Has anaemia',
    type: PicoTypeCode.BOOLEAN,
    isReportable: true,
  },
  {
    variable: 'needs_epo',
    label: 'Needs EPO assessment',
    type: PicoTypeCode.BOOLEAN,
    isReportable: true,
    category: OutputCategory.DETECTED_ISSUE,
  },
  {
    variable: 'declining',
    label: 'eGFR declining',
    type: PicoTypeCode.BOOLEAN,
    isReportable: true,
    category: OutputCategory.DETECTED_ISSUE,
  },
  {
    variable: 'cvd_risk',
    label: 'CVD risk score',
    type: PicoTypeCode.NUMERIC,
    isReportable: true,
    category: OutputCategory.RISK_ASSESSMENT,
  },
  {
    variable: 'has_dm',
    label: 'Has diabetes',
    type: PicoTypeCode.BOOLEAN,
    isReportable: true,
  },
  {
    variable: 'has_htn',
    label: 'Has hypertension',
    type: PicoTypeCode.BOOLEAN,
    isReportable: true,
  },
  // Internal variables — should not appear in output
  {
    variable: 'egfr_slope',
    label: 'eGFR regression slope',
    type: PicoTypeCode.NUMERIC,
    isReportable: false,
    category: OutputCategory.INTERNAL,
  },
  {
    variable: 'dm_dx',
    label: 'Diabetes first diagnosis date',
    type: PicoTypeCode.DATE,
    isReportable: false,
    category: OutputCategory.INTERNAL,
  },
  {
    variable: 'htn_dx',
    label: 'Hypertension first diagnosis date',
    type: PicoTypeCode.DATE,
    isReportable: false,
    category: OutputCategory.INTERNAL,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FhirOutputMapper', () => {
  // Evaluate first — this is the input to the mapper
  const adapter = new FhirDataAdapter(patientBundle);
  const parsed = parse([{
    name: 'ckd_assessment',
    text: ckdRuleblock,
    isActive: true,
  }]);
  const evalResult = evaluate(parsed[0] as any, adapter);

  const mapper = new FhirOutputMapper({
    patientReference: 'Patient/patient-42',
    ruleblockId: 'ckd_assessment',
    ruleblockDescription: 'CKD staging and management flags',
    ruleblockVersion: '2.1',
    attributes: attributeMetadata,
    performer: 'Device/picorules-engine',
  });

  // Sanity check: the evaluator produces expected results
  it('evaluation produces expected results (prerequisite)', () => {
    expect(evalResult.egfr_last).toBe(39);
    expect(evalResult.hb_last).toBe(108);
    expect(evalResult.ckd_stage).toBe(4);
    expect(evalResult.is_anaemic).toBe(1);
    expect(evalResult.needs_epo).toBe(0); // hb 108 >= 100
    expect(evalResult.declining).toBe(1);
    expect(evalResult.has_dm).toBe(1);
    expect(evalResult.has_htn).toBe(1);
    expect(evalResult.cvd_risk).toBe(4); // ckd_stage >= 4
  });

  describe('toBundle', () => {
    const bundle = mapper.toBundle(evalResult);

    it('produces a FHIR Bundle', () => {
      expect(bundle.resourceType).toBe('Bundle');
      expect(bundle.type).toBe('collection');
      expect(bundle.entry).toBeDefined();
      expect(bundle.entry!.length).toBeGreaterThan(0);
    });

    it('includes a Parameters resource', () => {
      const params = bundle.entry!.find(
        e => e.resource.resourceType === 'Parameters'
      );
      expect(params).toBeDefined();
      const p = params!.resource as unknown as Parameters;
      expect(p.parameter.length).toBeGreaterThan(0);
    });

    it('includes a GuidanceResponse', () => {
      const gr = bundle.entry!.find(
        e => e.resource.resourceType === 'GuidanceResponse'
      );
      expect(gr).toBeDefined();
      const g = gr!.resource as unknown as GuidanceResponse;
      expect(g.status).toBe('success');
      expect(g.subject.reference).toBe('Patient/patient-42');
      expect(g.moduleUri).toContain('ckd_assessment');
      expect(g.performer?.reference).toBe('Device/picorules-engine');
    });

    it('includes Observations for reportable clinical values', () => {
      const observations = bundle.entry!
        .filter(e => e.resource.resourceType === 'Observation')
        .map(e => e.resource as Observation);

      expect(observations.length).toBeGreaterThan(0);

      // Should have egfr_last, hb_last, ckd_stage, is_anaemic, has_dm, has_htn
      const codes = observations.map(
        o => o.code.coding?.find(c => c.system === 'urn:picorules:variable')?.code
      );
      expect(codes).toContain('egfr_last');
      expect(codes).toContain('hb_last');
      expect(codes).toContain('ckd_stage');
      expect(codes).toContain('is_anaemic');
      expect(codes).toContain('has_dm');
      expect(codes).toContain('has_htn');
    });

    it('does NOT include internal variables as Observations', () => {
      const observations = bundle.entry!
        .filter(e => e.resource.resourceType === 'Observation')
        .map(e => e.resource as Observation);

      const codes = observations.map(
        o => o.code.coding?.find(c => c.system === 'urn:picorules:variable')?.code
      );
      expect(codes).not.toContain('egfr_slope');
      expect(codes).not.toContain('dm_dx');
      expect(codes).not.toContain('htn_dx');
    });

    it('includes RiskAssessment for cvd_risk', () => {
      const risks = bundle.entry!.filter(
        e => e.resource.resourceType === 'RiskAssessment'
      );
      expect(risks).toHaveLength(1);

      const ra = risks[0].resource as unknown as RiskAssessment;
      expect(ra.status).toBe('final');
      expect(ra.subject.reference).toBe('Patient/patient-42');
      expect(ra.prediction).toBeDefined();
      expect(ra.prediction![0].relativeRisk).toBe(4);
      expect(ra.prediction![0].outcome?.text).toBe('CVD risk score');
    });

    it('includes DetectedIssue for truthy action flags', () => {
      const issues = bundle.entry!.filter(
        e => e.resource.resourceType === 'DetectedIssue'
      );

      // declining=1 should produce a DetectedIssue, needs_epo=0 should not
      const issueCodes = issues.map(
        i => (i.resource as unknown as DetectedIssue).code?.coding?.[0]?.code
      );
      expect(issueCodes).toContain('declining');
      expect(issueCodes).not.toContain('needs_epo'); // needs_epo=0, not truthy
    });
  });

  describe('toObservations', () => {
    const observations = mapper.toObservations(evalResult);

    it('produces Observation resources', () => {
      expect(observations.length).toBeGreaterThan(0);
      observations.forEach(obs => {
        expect(obs.resourceType).toBe('Observation');
        expect(obs.status).toBe('final');
      });
    });

    it('sets valueQuantity for numeric variables with units', () => {
      const egfr = observations.find(
        o => o.code.coding?.some(c => c.code === 'egfr_last')
      );
      expect(egfr).toBeDefined();
      expect(egfr!.valueQuantity).toBeDefined();
      expect(egfr!.valueQuantity!.value).toBe(39);
      expect(egfr!.valueQuantity!.unit).toBe('mL/min/1.73m2');
      expect(egfr!.valueQuantity!.system).toBe('http://unitsofmeasure.org');
    });

    it('includes LOINC code when provided in metadata', () => {
      const egfr = observations.find(
        o => o.code.coding?.some(c => c.code === 'egfr_last')
      );
      expect(egfr).toBeDefined();
      const loincCoding = egfr!.code.coding?.find(c => c.system === 'http://loinc.org');
      expect(loincCoding).toBeDefined();
      expect(loincCoding!.code).toBe('33914-3');
    });

    it('sets valueInteger for boolean variables', () => {
      const anaemic = observations.find(
        o => o.code.coding?.some(c => c.code === 'is_anaemic')
      );
      expect(anaemic).toBeDefined();
      expect(anaemic!.valueInteger).toBe(1);
    });

    it('sets category to survey for calculated observations', () => {
      observations.forEach(obs => {
        const cat = obs.category?.[0]?.coding?.[0];
        expect(cat?.code).toBe('survey');
      });
    });

    it('includes subject reference on all observations', () => {
      observations.forEach(obs => {
        expect(obs.subject?.reference).toBe('Patient/patient-42');
      });
    });
  });

  describe('toParameters', () => {
    const params = mapper.toParameters(evalResult);

    it('produces a Parameters resource with all non-null variables', () => {
      expect(params.resourceType).toBe('Parameters');
      expect(params.parameter.length).toBeGreaterThan(0);
    });

    it('uses correct FHIR parameter types', () => {
      const egfr = params.parameter.find(p => p.name === 'egfr_last');
      expect(egfr).toBeDefined();
      // 39 is integer
      expect(egfr!.valueInteger).toBe(39);

      const ckd = params.parameter.find(p => p.name === 'ckd_stage');
      expect(ckd).toBeDefined();
      expect(ckd!.valueInteger).toBe(4);
    });

    it('includes internal variables (Parameters captures everything)', () => {
      const slope = params.parameter.find(p => p.name === 'egfr_slope');
      expect(slope).toBeDefined();
      expect(typeof slope!.valueDecimal === 'number' || typeof slope!.valueInteger === 'number').toBe(true);
    });
  });

  describe('toGuidanceResponse', () => {
    const gr = mapper.toGuidanceResponse();

    it('produces a valid GuidanceResponse', () => {
      expect(gr.resourceType).toBe('GuidanceResponse');
      expect(gr.status).toBe('success');
      expect(gr.subject.reference).toBe('Patient/patient-42');
    });

    it('includes ruleblock module URI', () => {
      expect(gr.moduleUri).toContain('ckd_assessment');
    });

    it('includes description as note', () => {
      expect(gr.note).toBeDefined();
      expect(gr.note![0].text).toContain('CKD staging');
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: FHIR Bundle → Evaluate → FHIR Bundle
// ---------------------------------------------------------------------------

describe('full circle: FHIR in → Picorules → FHIR out', () => {
  it('transforms a FHIR patient bundle through a ruleblock and back to FHIR', () => {
    // 1. FHIR in
    const inputAdapter = new FhirDataAdapter(patientBundle);

    // 2. Parse and evaluate
    const parsed = parse([{
      name: 'ckd_assessment',
      text: ckdRuleblock,
      isActive: true,
    }]);
    const result = evaluate(parsed[0] as any, inputAdapter);

    // 3. FHIR out
    const outputMapper = new FhirOutputMapper({
      patientReference: 'Patient/patient-42',
      ruleblockId: 'ckd_assessment',
      ruleblockDescription: 'CKD staging and management flags',
      attributes: attributeMetadata,
    });
    const outputBundle = outputMapper.toBundle(result);

    // Verify the full circle
    expect(outputBundle.resourceType).toBe('Bundle');

    // Should contain: Parameters, GuidanceResponse, Observations,
    // RiskAssessment, DetectedIssues
    const resourceTypes = outputBundle.entry!.map(e => e.resource.resourceType);
    expect(resourceTypes).toContain('Parameters');
    expect(resourceTypes).toContain('GuidanceResponse');
    expect(resourceTypes).toContain('Observation');
    expect(resourceTypes).toContain('RiskAssessment');
    expect(resourceTypes).toContain('DetectedIssue');

    // The output bundle could be posted to a FHIR server or returned
    // via a CDS Hooks response
    expect(outputBundle.entry!.length).toBeGreaterThan(5);
  });
});
