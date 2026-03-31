/**
 * FHIR R4 Data Adapter for the Picorules JS evaluator.
 *
 * Implements the DataAdapter interface from picorules-compiler-js-core,
 * allowing ruleblocks to be evaluated directly against a FHIR Bundle.
 *
 * Usage:
 *   const adapter = new FhirDataAdapter(bundle);
 *   const result = evaluate(parsedRuleblock, adapter);
 */

import type { DataAdapter, DataRecord } from 'picorules-compiler-js-core';
import type {
  Bundle, Resource, Observation, Condition, MedicationRequest,
  MedicationStatement, Procedure, Patient, Coding, CodeableConcept,
} from './fhir-types';
import {
  resolveAttribute, codeMatchesPattern,
  CODE_SYSTEMS, TerminologyEntry,
} from './terminology-map';

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface FhirDataAdapterOptions {
  /** Custom terminology overrides: EADV attribute name → FHIR mapping */
  overrides?: Record<string, TerminologyEntry>;
  /** Gender mapping: FHIR gender string → numeric value used in rules (default: male=1, female=0) */
  genderMap?: Record<string, number>;
}

const DEFAULT_GENDER_MAP: Record<string, number> = {
  male: 1,
  female: 0,
  other: 2,
  unknown: 3,
};

// ---------------------------------------------------------------------------
// FhirDataAdapter
// ---------------------------------------------------------------------------

export class FhirDataAdapter implements DataAdapter {
  private resources: Resource[];
  private patient: Patient | null;
  private overrides?: Record<string, TerminologyEntry>;
  private genderMap: Record<string, number>;

  // Cache: group resources by type for fast lookup
  private byType: Map<string, Resource[]>;

  constructor(bundle: Bundle, options?: FhirDataAdapterOptions) {
    this.resources = (bundle.entry ?? []).map(e => e.resource);
    this.overrides = options?.overrides;
    this.genderMap = options?.genderMap ?? DEFAULT_GENDER_MAP;

    // Group by resource type
    this.byType = new Map();
    for (const r of this.resources) {
      const type = r.resourceType;
      if (!this.byType.has(type)) this.byType.set(type, []);
      this.byType.get(type)!.push(r);
    }

    // Cache patient resource
    const patients = this.byType.get('Patient') ?? [];
    this.patient = patients.length > 0 ? patients[0] as Patient : null;
  }

  /**
   * Retrieve DataRecords matching the given EADV attribute list.
   * Each attribute is resolved to a FHIR code system + code, then
   * matching resources are found and converted to DataRecords.
   */
  getRecords(attributeList: string[]): DataRecord[] {
    const records: DataRecord[] = [];

    for (const att of attributeList) {
      // Strip wildcard for resolution, but keep it for matching
      const baseAtt = att.replace(/%$/, '');
      const isWildcard = att.endsWith('%');

      const entry = resolveAttribute(baseAtt, this.overrides);
      if (!entry) continue;

      const typeResources = this.byType.get(entry.resourceType) ?? [];

      for (const resource of typeResources) {
        const matched = this.matchResource(resource, entry, att, isWildcard);
        if (matched) {
          records.push(matched);
        }
      }
    }

    return records;
  }

  // ---------------------------------------------------------------------------
  // Resource matching
  // ---------------------------------------------------------------------------

  private matchResource(
    resource: Resource,
    entry: TerminologyEntry,
    originalAtt: string,
    isWildcard: boolean
  ): DataRecord | null {
    switch (resource.resourceType) {
      case 'Observation':
        return this.matchObservation(resource as Observation, entry, originalAtt, isWildcard);
      case 'Condition':
        return this.matchCondition(resource as Condition, entry, originalAtt, isWildcard);
      case 'MedicationRequest':
        return this.matchMedicationRequest(resource as MedicationRequest, entry, originalAtt, isWildcard);
      case 'MedicationStatement':
        return this.matchMedicationStatement(resource as MedicationStatement, entry, originalAtt, isWildcard);
      case 'Procedure':
        return this.matchProcedure(resource as Procedure, entry, originalAtt, isWildcard);
      case 'Patient':
        return this.matchPatient(resource as Patient, entry);
      default:
        return null;
    }
  }

  private matchObservation(
    obs: Observation,
    entry: TerminologyEntry,
    att: string,
    isWildcard: boolean
  ): DataRecord | null {
    if (!this.codeMatches(obs.code, entry.system, entry.code, isWildcard)) return null;

    const val = this.extractObservationValue(obs, entry);
    const dt = this.extractDate(obs.effectiveDateTime ?? obs.effectivePeriod?.start);

    return { val, dt };
  }

  private matchCondition(
    cond: Condition,
    entry: TerminologyEntry,
    att: string,
    isWildcard: boolean
  ): DataRecord | null {
    if (!cond.code) return null;
    if (!this.codeMatches(cond.code, entry.system, entry.code, isWildcard)) return null;

    // Conditions typically have val=1 (presence) and dt=onsetDateTime
    const dt = this.extractDate(
      cond.onsetDateTime ?? cond.onsetPeriod?.start ?? cond.recordedDate
    );

    return { val: 1, dt };
  }

  private matchMedicationRequest(
    med: MedicationRequest,
    entry: TerminologyEntry,
    att: string,
    isWildcard: boolean
  ): DataRecord | null {
    if (!med.medicationCodeableConcept) return null;
    if (!this.codeMatches(med.medicationCodeableConcept, entry.system, entry.code, isWildcard)) return null;

    const dt = this.extractDate(med.authoredOn);
    return { val: 1, dt };
  }

  private matchMedicationStatement(
    med: MedicationStatement,
    entry: TerminologyEntry,
    att: string,
    isWildcard: boolean
  ): DataRecord | null {
    if (!med.medicationCodeableConcept) return null;
    if (!this.codeMatches(med.medicationCodeableConcept, entry.system, entry.code, isWildcard)) return null;

    const dt = this.extractDate(med.effectiveDateTime ?? med.effectivePeriod?.start);
    return { val: 1, dt };
  }

  private matchProcedure(
    proc: Procedure,
    entry: TerminologyEntry,
    att: string,
    isWildcard: boolean
  ): DataRecord | null {
    if (!proc.code) return null;
    if (!this.codeMatches(proc.code, entry.system, entry.code, isWildcard)) return null;

    const dt = this.extractDate(proc.performedDateTime ?? proc.performedPeriod?.start);
    return { val: 1, dt };
  }

  private matchPatient(
    patient: Patient,
    entry: TerminologyEntry
  ): DataRecord | null {
    if (entry.valuePath === 'gender') {
      const gender = patient.gender;
      const val = gender ? (this.genderMap[gender] ?? null) : null;
      return { val, dt: null };
    }

    if (entry.valuePath === 'birthDate') {
      const dt = this.extractDate(patient.birthDate);
      return { val: null, dt };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a CodeableConcept contains a coding matching the given system and code.
   * Supports wildcard matching on the code (e.g., E11% matches E11, E11.0, E11.9).
   */
  private codeMatches(
    concept: CodeableConcept,
    system: string,
    code: string,
    isWildcard: boolean
  ): boolean {
    if (!concept.coding) return false;

    return concept.coding.some(coding => {
      if (system && coding.system !== system) return false;
      if (!coding.code) return false;

      if (isWildcard) {
        return coding.code.toUpperCase().startsWith(code.toUpperCase());
      }
      return coding.code.toUpperCase() === code.toUpperCase();
    });
  }

  private extractObservationValue(
    obs: Observation,
    entry: TerminologyEntry
  ): number | string | null {
    if (obs.valueQuantity?.value !== undefined) {
      return obs.valueQuantity.value;
    }
    if (obs.valueString !== undefined) {
      return obs.valueString;
    }
    if (obs.valueInteger !== undefined) {
      return obs.valueInteger;
    }
    if (obs.valueCodeableConcept?.text) {
      return obs.valueCodeableConcept.text;
    }
    return null;
  }

  private extractDate(dateStr: string | undefined | null): Date | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
}
