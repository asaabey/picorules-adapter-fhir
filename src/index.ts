export { FhirDataAdapter, type FhirDataAdapterOptions } from './fhir-data-adapter';
export {
  resolveAttribute,
  codeMatchesPattern,
  CODE_SYSTEMS,
  LOINC_MAP,
  type TerminologyEntry,
} from './terminology-map';
export type {
  Bundle, BundleEntry, Resource,
  Patient, Observation, Condition, MedicationRequest, MedicationStatement,
  Procedure, Encounter, AllergyIntolerance,
  CodeableConcept, Coding, Quantity, Reference, Period,
} from './fhir-types';
