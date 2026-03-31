# Picorules Adapter FHIR

FHIR R4 data adapter for the [Picorules](https://www.npmjs.com/package/picorules-compiler-js-core) JS evaluator. Evaluate clinical decision support ruleblocks directly against FHIR Bundles — no database, no EADV flattening.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## How It Works

```
FHIR R4 Bundle (single patient)
    |
    v
FhirDataAdapter    <-- translates EADV attribute names to FHIR queries
    |
    v
Picorules Evaluator (from picorules-compiler-js-core)
    |
    v
{ egfr_last: 39, ckd_stage: 4, declining: 1, ... }
```

The adapter implements the `DataAdapter` interface from `picorules-compiler-js-core`. When the evaluator asks for records matching an EADV attribute (e.g., `lab_bld_egfr`), the adapter:

1. Resolves the attribute to a FHIR code system + code (LOINC `33914-3`)
2. Finds matching resources in the Bundle (Observations with that LOINC code)
3. Returns `{ val, dt }` records for the evaluator to aggregate

## Installation

```bash
npm install picorules-adapter-fhir picorules-compiler-js-core
```

## Quick Start

```typescript
import { parse, evaluate } from 'picorules-compiler-js-core';
import { FhirDataAdapter } from 'picorules-adapter-fhir';

// 1. Your FHIR R4 Bundle (from a FHIR server, file, etc.)
const bundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Observation',
        code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] },
        effectiveDateTime: '2025-01-10',
        valueQuantity: { value: 118, unit: 'g/L' },
      },
    },
    // ... more resources
  ],
};

// 2. Create the adapter
const adapter = new FhirDataAdapter(bundle);

// 3. Parse and evaluate a ruleblock
const parsed = parse([{
  name: 'anaemia',
  text: `
    #define_ruleblock(anaemia, { description: "Anaemia check", is_active: 2 });
    hb_last => eadv.lab_bld_haemoglobin.val.last();
    is_anaemic : { hb_last < 120 => 1 }, { => 0 };
  `,
  isActive: true,
}]);

const result = evaluate(parsed[0], adapter);
// { hb_last: 118, is_anaemic: 1 }
```

## Terminology Mapping

The adapter translates EADV attribute names to FHIR queries using three strategies:

### Auto-Derived (no configuration needed)

| EADV Prefix | FHIR Resource | Code System | Example |
|---|---|---|---|
| `icd_` | Condition | ICD-10 (`http://hl7.org/fhir/sid/icd-10`) | `icd_e11%` finds Conditions with ICD-10 codes starting with E11 |
| `icpc_` | Condition | ICPC-2 (`http://hl7.org/fhir/sid/icpc-2`) | `icpc_k86001` finds Conditions with ICPC-2 code K86001 |
| `rxnc_` | MedicationRequest | ATC (`http://www.whocc.no/atc`) | `rxnc_c09aa%` finds MedicationRequests with ATC codes starting with C09AA |

The EADV attribute name IS the code — the adapter strips the prefix and looks it up.

### Curated LOINC Lookup (80+ mappings built-in)

| EADV Attribute | LOINC Code | Description |
|---|---|---|
| `lab_bld_egfr` | 33914-3 | Estimated GFR |
| `lab_bld_haemoglobin` | 718-7 | Hemoglobin |
| `lab_bld_creatinine` | 2160-0 | Creatinine |
| `lab_bld_hba1c` | 4548-4 | HbA1c |
| `lab_bld_cholesterol_total` | 2093-3 | Total Cholesterol |
| `lab_bld_cholesterol_hdl` | 2085-9 | HDL Cholesterol |
| `lab_ua_acr` | 9318-7 | Albumin/Creatinine Ratio |
| `obs_bp_systolic` | 8480-6 | Systolic Blood Pressure |
| `obs_weight` | 29463-7 | Body Weight |
| `obs_height` | 8302-2 | Body Height |
| ... | ... | 70+ more |

See `src/terminology-map.ts` for the complete list.

### Demographics

| EADV Attribute | FHIR Path | Returns |
|---|---|---|
| `dmg_gender` | `Patient.gender` | 1 (male), 0 (female) |
| `dmg_dob` | `Patient.birthDate` | Date |

### Custom Overrides

Add your own mappings at runtime:

```typescript
const adapter = new FhirDataAdapter(bundle, {
  overrides: {
    'my_custom_lab': {
      system: 'http://loinc.org',
      code: '12345-6',
      resourceType: 'Observation',
      valuePath: 'valueQuantity.value',
      datePath: 'effectiveDateTime',
    },
  },
});
```

## Supported FHIR Resources

| Resource Type | Matched By | Value Extracted | Date Extracted |
|---|---|---|---|
| Observation | `code.coding` | `valueQuantity.value`, `valueString`, `valueInteger` | `effectiveDateTime` |
| Condition | `code.coding` | `1` (presence) | `onsetDateTime`, `recordedDate` |
| MedicationRequest | `medicationCodeableConcept.coding` | `1` (presence) | `authoredOn` |
| MedicationStatement | `medicationCodeableConcept.coding` | `1` (presence) | `effectiveDateTime` |
| Procedure | `code.coding` | `1` (presence) | `performedDateTime` |
| Patient | (direct fields) | `gender` (mapped to number), `birthDate` | `birthDate` |

## Wildcard Matching

EADV wildcard patterns work against FHIR codes:

```typescript
// icd_e11% matches E11, E11.0, E11.1, E11.9, etc.
has_dm => eadv.[icd_e11%].dt.exists();

// rxnc_c09% matches all RAAS inhibitors (C09AA, C09CA, etc.)
on_raas => eadv.[rxnc_c09%].dt.exists();
```

## API

### `FhirDataAdapter`

```typescript
new FhirDataAdapter(bundle: Bundle, options?: FhirDataAdapterOptions)
```

**Parameters:**
- `bundle` - FHIR R4 Bundle containing the patient's resources
- `options.overrides` - Custom EADV-to-FHIR terminology mappings
- `options.genderMap` - Custom gender string-to-number mapping (default: male=1, female=0)

**Implements:** `DataAdapter` from `picorules-compiler-js-core`

### `resolveAttribute(att, overrides?)`

Resolve an EADV attribute name to a FHIR terminology entry. Useful for debugging mappings.

### `CODE_SYSTEMS`

Object containing all official FHIR R4 code system URIs:
- `CODE_SYSTEMS.ICD10` - `http://hl7.org/fhir/sid/icd-10`
- `CODE_SYSTEMS.ICPC2` - `http://hl7.org/fhir/sid/icpc-2`
- `CODE_SYSTEMS.LOINC` - `http://loinc.org`
- `CODE_SYSTEMS.SNOMED` - `http://snomed.info/sct`
- `CODE_SYSTEMS.ATC` - `http://www.whocc.no/atc`
- `CODE_SYSTEMS.RXNORM` - `http://www.nlm.nih.gov/research/umls/rxnorm`

### `LOINC_MAP`

The curated EADV attribute to LOINC code mapping dictionary. Can be extended at runtime via overrides.

## Development

```bash
npm install
npm test        # 29 tests
npm run build   # CJS + ESM + types
```

## License

MIT

## Credits

Developed for The Kidney Centre (TKC) clinical decision support system.
