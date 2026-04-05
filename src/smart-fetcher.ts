/**
 * FhirSmartFetcher: Execute the minimal set of FHIR queries derived from
 * ruleblock introspection and assemble the results into a Bundle.
 *
 * Works with any FHIR client that can execute `request(url)` — compatible
 * with fhirclient.js, plain fetch, or server-side HTTP clients.
 */

import type { Bundle, BundleEntry, Resource } from './fhir-types';
import type { FhirSearchQuery } from './data-requirements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A function that fetches a FHIR URL and returns the parsed JSON. */
export type FhirFetchFn = (url: string) => Promise<any>;

/** Result of a smart fetch operation. */
export interface SmartFetchResult {
  /** Assembled FHIR Bundle ready for FhirDataAdapter */
  bundle: Bundle;
  /** Number of queries executed */
  queryCount: number;
  /** Total resources fetched */
  resourceCount: number;
  /** Per-query breakdown */
  queryResults: QueryResult[];
  /** Total fetch duration in ms */
  durationMs: number;
}

export interface QueryResult {
  resourceType: string;
  path: string;
  resourcesFetched: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Smart Fetcher
// ---------------------------------------------------------------------------

/**
 * Execute FHIR search queries in parallel and assemble a minimal Bundle.
 *
 * @param queries  - Search queries from `buildFhirSearchUrls()`
 * @param fetchFn  - Function to execute each FHIR request
 * @returns Bundle containing only the resources the rules need
 *
 * @example
 * ```typescript
 * const requirements = introspectDataRequirements(parsedRuleblocks);
 * const queries = buildFhirSearchUrls(requirements, patientId);
 * const { bundle } = await smartFetch(queries, (url) => fhirClient.request(url));
 * const adapter = new FhirDataAdapter(bundle);
 * const results = evaluateAll(parsedRuleblocks, adapter);
 * ```
 */
export async function smartFetch(
  queries: FhirSearchQuery[],
  fetchFn: FhirFetchFn
): Promise<SmartFetchResult> {
  const overallStart = Date.now();
  const entries: BundleEntry[] = [];
  const queryResults: QueryResult[] = [];

  // Execute all queries in parallel
  const results = await Promise.all(
    queries.map(async (query) => {
      const start = Date.now();
      const result = await fetchFn(query.path);
      const duration = Date.now() - start;
      return { query, result, duration };
    })
  );

  for (const { query, result, duration } of results) {
    let fetched = 0;

    if (query.resourceType === 'Patient') {
      // Patient read returns a single resource, not a Bundle
      if (result && result.resourceType === 'Patient') {
        entries.push({ resource: result as Resource });
        fetched = 1;
      }
    } else {
      // Search returns a Bundle with entries
      const searchBundle = result as Bundle;
      if (searchBundle?.entry) {
        for (const entry of searchBundle.entry) {
          if (entry.resource) {
            entries.push(entry);
            fetched++;
          }
        }
      }
    }

    queryResults.push({
      resourceType: query.resourceType,
      path: query.path,
      resourcesFetched: fetched,
      durationMs: duration,
    });
  }

  return {
    bundle: {
      resourceType: 'Bundle',
      type: 'collection',
      entry: entries,
    },
    queryCount: queries.length,
    resourceCount: entries.length,
    queryResults,
    durationMs: Date.now() - overallStart,
  };
}
