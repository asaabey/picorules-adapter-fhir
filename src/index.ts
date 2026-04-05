export { FhirDataAdapter, type FhirDataAdapterOptions } from './fhir-data-adapter';
export {
  FhirOutputMapper,
  PicoTypeCode,
  OutputCategory,
  type OutputAttributeMeta,
  type FhirOutputMapperOptions,
  type GuidanceResponse,
  type RiskAssessment,
  type DetectedIssue,
  type Parameters,
} from './fhir-output-mapper';
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

// Smart FHIR query introspection (v0.2.0)
export {
  extractAttributes,
  introspectDataRequirements,
  buildFhirSearchUrls,
  generateCdsHooksPrefetch,
  type FhirCodeRequirement,
  type DataRequirements,
  type FhirSearchQuery,
} from './data-requirements';

export {
  smartFetch,
  type FhirFetchFn,
  type SmartFetchResult,
  type QueryResult,
} from './smart-fetcher';
