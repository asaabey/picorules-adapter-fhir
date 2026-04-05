/**
 * Introspect parsed ruleblocks to extract the minimal set of FHIR data
 * requirements needed for evaluation.
 *
 * This enables "smart fetching" — querying a FHIR server for only the
 * resources the rules actually reference, instead of fetching everything.
 */

import { RuleType } from 'picorules-compiler-js-core';
import type { ParsedRuleblock, ParsedFetchStatement } from 'picorules-compiler-js-core';
import { resolveAttribute, type TerminologyEntry } from './terminology-map';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single FHIR code requirement derived from a ruleblock attribute. */
export interface FhirCodeRequirement {
  /** FHIR resource type (Observation, Condition, MedicationRequest, etc.) */
  resourceType: string;
  /** Code system URI (http://loinc.org, http://hl7.org/fhir/sid/icd-10, etc.) */
  system: string;
  /** Code value (33914-3, E11, C09AA, etc.) */
  code: string;
  /** Whether the original attribute used wildcard matching (e.g., icd_e11%) */
  isWildcard: boolean;
  /** Original EADV attribute name(s) that produced this requirement */
  sourceAttributes: string[];
}

/** Grouped requirements ready for FHIR query construction. */
export interface DataRequirements {
  /** All unique FHIR code requirements */
  requirements: FhirCodeRequirement[];
  /** Whether Patient demographics are needed */
  needsPatient: boolean;
  /** Unique resource types needed (excluding Patient) */
  resourceTypes: string[];
  /** Total unique EADV attributes referenced */
  attributeCount: number;
  /** Attributes that could not be resolved to FHIR codes */
  unmappedAttributes: string[];
}

/** A FHIR search query ready to execute. */
export interface FhirSearchQuery {
  /** FHIR resource type */
  resourceType: string;
  /** Full query path (e.g., "Observation?patient=X&code=http://loinc.org|33914-3,718-7") */
  path: string;
  /** Number of codes in this query */
  codeCount: number;
}

// ---------------------------------------------------------------------------
// Attribute extraction
// ---------------------------------------------------------------------------

/**
 * Extract all unique EADV attributes referenced by FETCH statements
 * across a set of parsed ruleblocks.
 */
export function extractAttributes(ruleblocks: ParsedRuleblock[]): Set<string> {
  const attributes = new Set<string>();

  for (const rb of ruleblocks) {
    for (const rule of rb.rules) {
      if (rule.ruleType === RuleType.FETCH_STATEMENT) {
        const fetch = rule as ParsedFetchStatement;
        for (const att of fetch.attributeList) {
          attributes.add(att.toLowerCase());
        }
      }
    }
  }

  return attributes;
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

/**
 * Introspect a set of parsed ruleblocks and return the minimal FHIR data
 * requirements needed to evaluate them.
 *
 * @param ruleblocks - Parsed ruleblocks from `parse()`
 * @param overrides  - Optional custom EADV → FHIR mappings
 * @returns Structured data requirements with FHIR codes grouped by resource type
 */
export function introspectDataRequirements(
  ruleblocks: ParsedRuleblock[],
  overrides?: Record<string, TerminologyEntry>
): DataRequirements {
  const attributes = extractAttributes(ruleblocks);
  const unmappedAttributes: string[] = [];
  let needsPatient = false;

  // Resolve each attribute and deduplicate by (resourceType, system, code)
  const requirementMap = new Map<string, FhirCodeRequirement>();

  for (const att of attributes) {
    const baseAtt = att.replace(/%$/, '');
    const isWildcard = att.endsWith('%');

    const entry = resolveAttribute(baseAtt, overrides);
    if (!entry) {
      unmappedAttributes.push(att);
      continue;
    }

    if (entry.resourceType === 'Patient') {
      needsPatient = true;
      continue;
    }

    const key = `${entry.resourceType}|${entry.system}|${entry.code}|${isWildcard}`;

    if (requirementMap.has(key)) {
      requirementMap.get(key)!.sourceAttributes.push(att);
    } else {
      requirementMap.set(key, {
        resourceType: entry.resourceType,
        system: entry.system,
        code: entry.code,
        isWildcard,
        sourceAttributes: [att],
      });
    }
  }

  const requirements = Array.from(requirementMap.values());
  const resourceTypes = [...new Set(requirements.map((r) => r.resourceType))];

  return {
    requirements,
    needsPatient,
    resourceTypes,
    attributeCount: attributes.size,
    unmappedAttributes,
  };
}

// ---------------------------------------------------------------------------
// FHIR Search URL Builder
// ---------------------------------------------------------------------------

/** Maximum number of codes per query to stay within URL length limits. */
const MAX_CODES_PER_QUERY = 80;

/**
 * Build minimal FHIR search URLs from data requirements.
 *
 * Groups codes by resource type and constructs queries using the standard
 * FHIR token search syntax (system|code, comma-separated for OR).
 *
 * For resource types with wildcard codes (e.g., ICD-10 prefixes), the
 * builder includes the base code and relies on client-side filtering
 * for precision.
 *
 * @param requirements - Output from `introspectDataRequirements()`
 * @param patientId    - FHIR Patient ID
 * @returns Array of search queries, one per resource type (or batched if many codes)
 */
export function buildFhirSearchUrls(
  requirements: DataRequirements,
  patientId: string
): FhirSearchQuery[] {
  const queries: FhirSearchQuery[] = [];

  // Always include Patient read if demographics are needed
  if (requirements.needsPatient) {
    queries.push({
      resourceType: 'Patient',
      path: `Patient/${patientId}`,
      codeCount: 0,
    });
  }

  // Group requirements by resource type
  const groups = new Map<string, FhirCodeRequirement[]>();
  for (const req of requirements.requirements) {
    if (!groups.has(req.resourceType)) {
      groups.set(req.resourceType, []);
    }
    groups.get(req.resourceType)!.push(req);
  }

  for (const [resourceType, reqs] of groups) {
    // Build system|code tokens, deduplicating
    const codeTokens = new Set<string>();
    let hasWildcards = false;

    for (const req of reqs) {
      if (req.isWildcard) {
        hasWildcards = true;
        // Include the base code — FHIR servers may match prefixes.
        // Client-side filtering handles precision.
        codeTokens.add(`${req.system}|${req.code}`);
      } else {
        codeTokens.add(`${req.system}|${req.code}`);
      }
    }

    const allTokens = [...codeTokens];

    // For resource types with many wildcards (Condition with ICD-10 prefixes),
    // it's more reliable to fetch all and filter client-side
    if (hasWildcards && resourceType === 'Condition') {
      // Fetch all conditions for this patient — small volume, reliable wildcards
      queries.push({
        resourceType,
        path: `${resourceType}?patient=${patientId}`,
        codeCount: allTokens.length,
      });
      continue;
    }

    // Batch codes to stay within URL limits
    for (let i = 0; i < allTokens.length; i += MAX_CODES_PER_QUERY) {
      const batch = allTokens.slice(i, i + MAX_CODES_PER_QUERY);
      const codeParam = batch.join(',');

      queries.push({
        resourceType,
        path: `${resourceType}?patient=${patientId}&code=${codeParam}`,
        codeCount: batch.length,
      });
    }
  }

  return queries;
}

// ---------------------------------------------------------------------------
// CDS Hooks Prefetch Generation
// ---------------------------------------------------------------------------

/**
 * Generate CDS Hooks-compatible prefetch templates from data requirements.
 *
 * The output can be used directly in a CDS Hooks service definition,
 * making Picorules ruleblocks self-describing CDS artefacts.
 *
 * @param requirements - Output from `introspectDataRequirements()`
 * @returns Record of prefetch key → FHIR query template (using {{context.patientId}})
 */
export function generateCdsHooksPrefetch(
  requirements: DataRequirements
): Record<string, string> {
  const prefetch: Record<string, string> = {};
  const patientRef = '{{context.patientId}}';

  if (requirements.needsPatient) {
    prefetch['patient'] = `Patient/{{context.patientId}}`;
  }

  // Group by resource type
  const groups = new Map<string, FhirCodeRequirement[]>();
  for (const req of requirements.requirements) {
    if (!groups.has(req.resourceType)) {
      groups.set(req.resourceType, []);
    }
    groups.get(req.resourceType)!.push(req);
  }

  for (const [resourceType, reqs] of groups) {
    const key = resourceType.toLowerCase() + 's';
    const hasWildcards = reqs.some((r) => r.isWildcard);

    if (hasWildcards && resourceType === 'Condition') {
      prefetch[key] = `${resourceType}?patient=${patientRef}`;
      continue;
    }

    const tokens = [...new Set(reqs.map((r) => `${r.system}|${r.code}`))];
    prefetch[key] = `${resourceType}?patient=${patientRef}&code=${tokens.join(',')}`;
  }

  return prefetch;
}
