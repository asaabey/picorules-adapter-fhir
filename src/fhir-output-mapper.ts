/**
 * FHIR R4 Output Mapper for Picorules evaluation results.
 *
 * Converts an EvaluationResult (the flat { variable: value } map produced by
 * the Picorules JS evaluator) into FHIR R4 resources suitable for writing
 * back to a FHIR server, returning via CDS Hooks, or including in a Bundle.
 *
 * The mapping is driven by #define_attribute metadata from the ruleblock,
 * which provides type codes, labels, and reportability flags.
 *
 * Output resource types:
 *   - GuidanceResponse  — wraps the entire ruleblock evaluation
 *   - Observation        — individual computed clinical values and classifications
 *   - RiskAssessment     — variables tagged as risk scores
 *   - DetectedIssue      — variables tagged as care gap / action flags
 *
 * Usage:
 *   const mapper = new FhirOutputMapper({ ... });
 *   const bundle = mapper.toBundle(evaluationResult);
 *   const observations = mapper.toObservations(evaluationResult);
 */

import type {
  Bundle, BundleEntry, Resource, Observation,
  CodeableConcept, Coding, Quantity, Reference, Period,
} from './fhir-types';

// ---------------------------------------------------------------------------
// Attribute metadata (mirrors #define_attribute from the ruleblock)
// ---------------------------------------------------------------------------

/** Type codes from #define_attribute (matches Picorules convention) */
export enum PicoTypeCode {
  NUMERIC = 1001,
  TEXT    = 1002,
  DATE    = 1003,
  BOOLEAN = 1004,
}

/** Output category — determines which FHIR resource type to produce */
export enum OutputCategory {
  /** Default: produces an Observation (category: calculated) */
  OBSERVATION = 'observation',
  /** Produces a RiskAssessment resource */
  RISK_ASSESSMENT = 'risk-assessment',
  /** Produces a DetectedIssue resource */
  DETECTED_ISSUE = 'detected-issue',
  /** Internal variable — skip, do not output */
  INTERNAL = 'internal',
}

/** Metadata for a single output variable, derived from #define_attribute */
export interface OutputAttributeMeta {
  /** Variable name (must match the key in EvaluationResult) */
  variable: string;
  /** Human-readable label from #define_attribute */
  label: string;
  /** Picorules type code: 1001=numeric, 1002=text, 1003=date, 1004=boolean */
  type: PicoTypeCode;
  /** Whether this variable is reportable (from #define_attribute) */
  isReportable: boolean;
  /** Whether this is a BI object (from #define_attribute) */
  isBiObj?: boolean;
  /** Output category — defaults to OBSERVATION if not specified */
  category?: OutputCategory;
  /** Optional LOINC/SNOMED code for the output observation */
  code?: Coding;
  /** Optional unit for numeric values (e.g., "mL/min/1.73m2") */
  unit?: string;
  /** Optional unit code (UCUM) */
  unitCode?: string;
}

// ---------------------------------------------------------------------------
// Mapper options
// ---------------------------------------------------------------------------

export interface FhirOutputMapperOptions {
  /** Patient reference (e.g., "Patient/123") */
  patientReference: string;
  /** Ruleblock identifier (used in GuidanceResponse.moduleUri) */
  ruleblockId: string;
  /** Ruleblock description */
  ruleblockDescription?: string;
  /** Ruleblock version */
  ruleblockVersion?: string;
  /** Attribute metadata for output variables */
  attributes: OutputAttributeMeta[];
  /** Performer reference (e.g., "Device/picorules-engine") */
  performer?: string;
  /** Base URI for Picorules module references */
  moduleBaseUri?: string;
  /** Whether to include non-reportable variables in output (default: false) */
  includeNonReportable?: boolean;
  /** Whether to include a GuidanceResponse wrapper (default: true) */
  includeGuidanceResponse?: boolean;
  /** Encounter reference (optional context) */
  encounterReference?: string;
}

// ---------------------------------------------------------------------------
// FHIR resource types for output (extending the existing fhir-types)
// ---------------------------------------------------------------------------

export interface GuidanceResponse {
  resourceType: 'GuidanceResponse';
  id?: string;
  moduleUri: string;
  status: 'success' | 'data-required' | 'data-requested' | 'in-progress' | 'failure' | 'entered-in-error';
  subject: Reference;
  encounter?: Reference;
  occurrenceDateTime: string;
  performer?: Reference;
  outputParameters?: Reference;
  note?: Array<{ text: string }>;
}

export interface RiskAssessment {
  resourceType: 'RiskAssessment';
  id?: string;
  status: 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error';
  subject: Reference;
  encounter?: Reference;
  occurrenceDateTime: string;
  method?: CodeableConcept;
  prediction?: Array<{
    outcome?: CodeableConcept;
    qualitativeRisk?: CodeableConcept;
    relativeRisk?: number;
  }>;
  note?: Array<{ text: string }>;
}

export interface DetectedIssue {
  resourceType: 'DetectedIssue';
  id?: string;
  status: 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error';
  code?: CodeableConcept;
  patient: Reference;
  identifiedDateTime?: string;
  detail?: string;
  evidence?: Array<{
    code?: CodeableConcept[];
    detail?: Reference[];
  }>;
}

export interface Parameters {
  resourceType: 'Parameters';
  id?: string;
  parameter: Array<{
    name: string;
    valueString?: string;
    valueDecimal?: number;
    valueInteger?: number;
    valueBoolean?: boolean;
    valueDateTime?: string;
  }>;
}

// ---------------------------------------------------------------------------
// FhirOutputMapper
// ---------------------------------------------------------------------------

export class FhirOutputMapper {
  private options: FhirOutputMapperOptions;
  private attributeMap: Map<string, OutputAttributeMeta>;

  constructor(options: FhirOutputMapperOptions) {
    this.options = options;
    this.attributeMap = new Map();
    for (const attr of options.attributes) {
      this.attributeMap.set(attr.variable, attr);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Convert an evaluation result to a complete FHIR Bundle containing
   * all output resources (GuidanceResponse, Observations, RiskAssessments,
   * DetectedIssues).
   */
  toBundle(result: Record<string, number | string | Date | null>): Bundle {
    const entries: BundleEntry[] = [];
    const now = new Date().toISOString();

    // GuidanceResponse wrapper
    if (this.options.includeGuidanceResponse !== false) {
      const params = this.toParameters(result);
      entries.push({ resource: params as unknown as Resource });

      const guidance = this.toGuidanceResponse(now, params.id);
      entries.push({ resource: guidance as unknown as Resource });
    }

    // Individual resources per variable
    for (const [variable, value] of Object.entries(result)) {
      // Skip _dt companion variables (handled alongside their _val parent)
      if (variable.endsWith('_dt')) continue;

      const meta = this.attributeMap.get(variable);

      // Skip non-reportable unless explicitly requested
      if (meta && !meta.isReportable && !this.options.includeNonReportable) continue;

      // Skip variables explicitly marked as internal
      if (meta?.category === OutputCategory.INTERNAL) continue;

      // Skip null values
      if (value === null || value === undefined) continue;

      const category = meta?.category ?? OutputCategory.OBSERVATION;

      switch (category) {
        case OutputCategory.OBSERVATION:
          entries.push({
            resource: this.variableToObservation(variable, value, result, meta, now) as unknown as Resource,
          });
          break;

        case OutputCategory.RISK_ASSESSMENT:
          entries.push({
            resource: this.variableToRiskAssessment(variable, value, meta, now) as unknown as Resource,
          });
          break;

        case OutputCategory.DETECTED_ISSUE:
          if (this.isTruthy(value)) {
            entries.push({
              resource: this.variableToDetectedIssue(variable, value, meta, now) as unknown as Resource,
            });
          }
          break;
      }
    }

    return {
      resourceType: 'Bundle',
      type: 'collection',
      entry: entries,
    };
  }

  /**
   * Convert evaluation result to Observation resources only.
   * Useful when you just need the clinical observations without the wrapper.
   */
  toObservations(result: Record<string, number | string | Date | null>): Observation[] {
    const now = new Date().toISOString();
    const observations: Observation[] = [];

    for (const [variable, value] of Object.entries(result)) {
      if (variable.endsWith('_dt')) continue;
      if (value === null || value === undefined) continue;

      const meta = this.attributeMap.get(variable);
      if (meta && !meta.isReportable && !this.options.includeNonReportable) continue;
      if (meta?.category === OutputCategory.INTERNAL) continue;

      const category = meta?.category ?? OutputCategory.OBSERVATION;
      if (category !== OutputCategory.OBSERVATION) continue;

      observations.push(this.variableToObservation(variable, value, result, meta, now));
    }

    return observations;
  }

  /**
   * Convert evaluation result to a GuidanceResponse with embedded Parameters.
   */
  toGuidanceResponse(
    now?: string,
    parametersId?: string,
  ): GuidanceResponse {
    const effectiveNow = now ?? new Date().toISOString();
    const moduleUri = this.options.moduleBaseUri
      ? `${this.options.moduleBaseUri}/${this.options.ruleblockId}`
      : `urn:picorules:ruleblock:${this.options.ruleblockId}`;

    const guidance: GuidanceResponse = {
      resourceType: 'GuidanceResponse',
      moduleUri,
      status: 'success',
      subject: { reference: this.options.patientReference },
      occurrenceDateTime: effectiveNow,
    };

    if (this.options.encounterReference) {
      guidance.encounter = { reference: this.options.encounterReference };
    }

    if (this.options.performer) {
      guidance.performer = { reference: this.options.performer };
    }

    if (parametersId) {
      guidance.outputParameters = { reference: `#${parametersId}` };
    }

    if (this.options.ruleblockDescription) {
      guidance.note = [{ text: this.options.ruleblockDescription }];
    }

    return guidance;
  }

  /**
   * Convert all evaluation result variables to a FHIR Parameters resource.
   * This captures the complete output regardless of reportability.
   */
  toParameters(result: Record<string, number | string | Date | null>): Parameters {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      id: `params-${this.options.ruleblockId}`,
      parameter: [],
    };

    for (const [variable, value] of Object.entries(result)) {
      if (value === null || value === undefined) continue;

      const param: Parameters['parameter'][number] = { name: variable };

      if (value instanceof Date) {
        param.valueDateTime = value.toISOString();
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          param.valueInteger = value;
        } else {
          param.valueDecimal = value;
        }
      } else if (typeof value === 'boolean') {
        param.valueBoolean = value;
      } else {
        param.valueString = String(value);
      }

      parameters.parameter.push(param);
    }

    return parameters;
  }

  // -------------------------------------------------------------------------
  // Resource builders
  // -------------------------------------------------------------------------

  private variableToObservation(
    variable: string,
    value: number | string | Date,
    fullResult: Record<string, number | string | Date | null>,
    meta: OutputAttributeMeta | undefined,
    now: string,
  ): Observation {
    const obs: Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'survey',
          display: 'Survey',
        }],
      }],
      code: this.buildObservationCode(variable, meta),
      subject: { reference: this.options.patientReference },
      effectiveDateTime: now,
    };

    // Set the value based on type
    if (meta) {
      this.setObservationValue(obs, value, meta);
    } else {
      // No metadata — infer from JS type
      this.setObservationValueInferred(obs, value);
    }

    // If there's a companion _dt variable, add it as an extension or note
    const dtKey = `${variable}_dt`;
    const dtValue = fullResult[dtKey];
    if (dtValue instanceof Date) {
      // The _dt companion indicates when the source observation was recorded
      // Use Observation.note to capture this provenance
      obs.component = obs.component ?? [];
      obs.component.push({
        code: {
          coding: [{
            system: 'urn:picorules:component',
            code: 'source-date',
            display: 'Source observation date',
          }],
        },
        valueString: dtValue.toISOString().slice(0, 10),
      });
    }

    return obs;
  }

  private variableToRiskAssessment(
    variable: string,
    value: number | string | Date,
    meta: OutputAttributeMeta | undefined,
    now: string,
  ): RiskAssessment {
    const label = meta?.label ?? variable;

    const assessment: RiskAssessment = {
      resourceType: 'RiskAssessment',
      status: 'final',
      subject: { reference: this.options.patientReference },
      occurrenceDateTime: now,
      method: {
        coding: [{
          system: 'urn:picorules:ruleblock',
          code: this.options.ruleblockId,
          display: this.options.ruleblockDescription ?? this.options.ruleblockId,
        }],
        text: `Picorules ruleblock: ${this.options.ruleblockId}`,
      },
    };

    if (this.options.encounterReference) {
      assessment.encounter = { reference: this.options.encounterReference };
    }

    // Map score to a prediction
    if (typeof value === 'number') {
      assessment.prediction = [{
        outcome: {
          text: label,
        },
        relativeRisk: value,
      }];
    } else {
      assessment.prediction = [{
        outcome: {
          text: label,
        },
        qualitativeRisk: {
          text: String(value),
        },
      }];
    }

    return assessment;
  }

  private variableToDetectedIssue(
    variable: string,
    value: number | string | Date,
    meta: OutputAttributeMeta | undefined,
    now: string,
  ): DetectedIssue {
    const label = meta?.label ?? variable;

    return {
      resourceType: 'DetectedIssue',
      status: 'final',
      code: {
        coding: [{
          system: 'urn:picorules:detected-issue',
          code: variable,
          display: label,
        }],
        text: label,
      },
      patient: { reference: this.options.patientReference },
      identifiedDateTime: now,
      detail: `Picorules (${this.options.ruleblockId}): ${label} = ${value}`,
    };
  }

  // -------------------------------------------------------------------------
  // Value helpers
  // -------------------------------------------------------------------------

  private buildObservationCode(
    variable: string,
    meta: OutputAttributeMeta | undefined,
  ): CodeableConcept {
    const codings: Coding[] = [];

    // Use explicit code if provided in metadata
    if (meta?.code) {
      codings.push(meta.code);
    }

    // Always include the Picorules variable as a coding
    codings.push({
      system: 'urn:picorules:variable',
      code: variable,
      display: meta?.label ?? variable,
    });

    return {
      coding: codings,
      text: meta?.label ?? variable,
    };
  }

  private setObservationValue(
    obs: Observation,
    value: number | string | Date,
    meta: OutputAttributeMeta,
  ): void {
    switch (meta.type) {
      case PicoTypeCode.NUMERIC:
        obs.valueQuantity = { value: value as number };
        if (meta.unit) {
          obs.valueQuantity.unit = meta.unit;
        }
        if (meta.unitCode) {
          obs.valueQuantity.system = 'http://unitsofmeasure.org';
          obs.valueQuantity.code = meta.unitCode;
        }
        break;

      case PicoTypeCode.BOOLEAN:
        // FHIR doesn't have valueBoolean on Observation — use valueInteger
        // Convention: 1=true, 0=false (matches Picorules convention)
        obs.valueInteger = value as number;
        break;

      case PicoTypeCode.TEXT:
        obs.valueString = String(value);
        break;

      case PicoTypeCode.DATE:
        if (value instanceof Date) {
          obs.valueString = value.toISOString().slice(0, 10);
        } else {
          obs.valueString = String(value);
        }
        break;

      default:
        this.setObservationValueInferred(obs, value);
    }
  }

  private setObservationValueInferred(
    obs: Observation,
    value: number | string | Date,
  ): void {
    if (value instanceof Date) {
      obs.valueString = value.toISOString().slice(0, 10);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && (value === 0 || value === 1)) {
        // Likely a boolean flag
        obs.valueInteger = value;
      } else {
        obs.valueQuantity = { value };
      }
    } else {
      obs.valueString = String(value);
    }
  }

  private isTruthy(value: number | string | Date | null): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value !== '' && value !== '0';
    return true; // Date is truthy
  }
}
