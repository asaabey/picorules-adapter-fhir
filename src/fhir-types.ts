/**
 * Minimal FHIR R4 type definitions for the adapter.
 * Only the types/fields we actually need — not the full FHIR spec.
 * Avoids pulling in a heavy @types/fhir dependency.
 */

export interface Bundle {
  resourceType: 'Bundle';
  type?: string;
  entry?: BundleEntry[];
}

export interface BundleEntry {
  resource: Resource;
}

export type Resource =
  | Patient
  | Observation
  | Condition
  | MedicationRequest
  | MedicationStatement
  | Procedure
  | Encounter
  | AllergyIntolerance
  | GenericResource;

export interface ResourceBase {
  resourceType: string;
  id?: string;
}

export interface Patient extends ResourceBase {
  resourceType: 'Patient';
  gender?: string;
  birthDate?: string;
}

export interface Observation extends ResourceBase {
  resourceType: 'Observation';
  status?: string;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueInteger?: number;
  component?: ObservationComponent[];
}

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
}

export interface Condition extends ResourceBase {
  resourceType: 'Condition';
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  code?: CodeableConcept;
  subject?: Reference;
  onsetDateTime?: string;
  onsetPeriod?: Period;
  recordedDate?: string;
}

export interface MedicationRequest extends ResourceBase {
  resourceType: 'MedicationRequest';
  status?: string;
  intent?: string;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject?: Reference;
  authoredOn?: string;
}

export interface MedicationStatement extends ResourceBase {
  resourceType: 'MedicationStatement';
  status?: string;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject?: Reference;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
}

export interface Procedure extends ResourceBase {
  resourceType: 'Procedure';
  status?: string;
  code?: CodeableConcept;
  subject?: Reference;
  performedDateTime?: string;
  performedPeriod?: Period;
}

export interface Encounter extends ResourceBase {
  resourceType: 'Encounter';
  status?: string;
  class?: Coding;
  type?: CodeableConcept[];
  subject?: Reference;
  period?: Period;
}

export interface AllergyIntolerance extends ResourceBase {
  resourceType: 'AllergyIntolerance';
  clinicalStatus?: CodeableConcept;
  code?: CodeableConcept;
  patient?: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
}

export interface GenericResource extends ResourceBase {
  [key: string]: unknown;
}

// --- FHIR Data Types ---

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface Period {
  start?: string;
  end?: string;
}
