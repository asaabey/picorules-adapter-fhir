/**
 * Terminology mapping between EADV attribute names and FHIR code systems.
 *
 * Strategy:
 *   1. Auto-derive: ICD-10, ICPC-2, ATC codes are embedded in the attribute name
 *   2. Curated lookup: LOINC codes for labs/observations need explicit mapping
 *   3. User overrides: Custom mappings passed at runtime
 */

// ---------------------------------------------------------------------------
// FHIR R4 Code System URIs (official HL7)
// ---------------------------------------------------------------------------

export const CODE_SYSTEMS = {
  ICD10:    'http://hl7.org/fhir/sid/icd-10',
  ICPC2:    'http://hl7.org/fhir/sid/icpc-2',
  LOINC:    'http://loinc.org',
  SNOMED:   'http://snomed.info/sct',
  ATC:      'http://www.whocc.no/atc',
  RXNORM:   'http://www.nlm.nih.gov/research/umls/rxnorm',
} as const;

// ---------------------------------------------------------------------------
// FHIR Resource type for each EADV prefix
// ---------------------------------------------------------------------------

export const PREFIX_RESOURCE_MAP: Record<string, string> = {
  'icd_':    'Condition',
  'icpc_':   'Condition',
  'lab_':    'Observation',
  'obs_':    'Observation',
  'rxnc_':   'MedicationRequest',
  'rx_':     'MedicationRequest',
  'enc_':    'Encounter',
  'proc_':   'Procedure',
  'dmg_':    'Patient',
  'status_': 'Observation',
};

// ---------------------------------------------------------------------------
// Terminology mapping entry
// ---------------------------------------------------------------------------

export interface TerminologyEntry {
  /** FHIR code system URI */
  system: string;
  /** FHIR code value */
  code: string;
  /** FHIR resource type to search */
  resourceType: string;
  /** How to extract the value from the resource */
  valuePath?: 'valueQuantity.value' | 'valueString' | 'code' | 'gender' | 'birthDate';
  /** How to extract the date from the resource */
  datePath?: 'effectiveDateTime' | 'onsetDateTime' | 'authoredOn' | 'recordedDate' | 'performedDateTime' | 'birthDate';
}

// ---------------------------------------------------------------------------
// Curated LOINC mappings for common lab/observation attributes
// ---------------------------------------------------------------------------

export const LOINC_MAP: Record<string, string> = {
  // Renal function
  'lab_bld_egfr':              '33914-3',
  'lab_bld_egfr_c':            '33914-3',
  'lab_bld_creatinine':        '2160-0',
  'lab_bld_urea':              '3094-0',
  'lab_bld_cystatin_c':        '33863-2',
  'lab_ua_acr':                '9318-7',
  'lab_ua_pcr':                '2890-2',
  'lab_ua_protein':            '5804-0',
  'lab_ua_rbc':                '30391-8',
  'lab_ua_wbc':                '5821-4',
  'lab_ua_leucocytes':         '5821-4',
  'lab_ua_poc_leucocytes':     '5821-4',
  'lab_ua_poc_rbc':            '30391-8',

  // Haematology
  'lab_bld_haemoglobin':       '718-7',
  'lab_bld_hb':                '718-7',
  'lab_bld_wbc':               '6690-2',
  'lab_bld_platelet':          '777-3',
  'lab_bld_rbc':               '789-8',
  'lab_bld_ferritin':          '2276-4',
  'lab_bld_iron':              '2498-4',
  'lab_bld_transferrin_sat':   '2502-3',

  // Metabolic / Diabetes
  'lab_bld_hba1c':             '4548-4',
  'lab_bld_hba1c_ngsp':        '4548-4',
  'lab_bld_hba1c_ifcc':        '59261-8',
  'lab_bld_glucose':           '2339-0',
  'lab_bld_glucose_fasting':   '1558-6',
  'lab_bld_glucose_random':    '2339-0',
  'lab_bld_glucose_ogtt_0h':   '1558-6',
  'lab_bld_glucose_ogtt_2h':   '1518-0',

  // Lipids
  'lab_bld_cholesterol_total': '2093-3',
  'lab_bld_cholesterol_hdl':   '2085-9',
  'lab_bld_cholesterol_ldl':   '2089-1',
  'lab_bld_cholesterol_tg':    '2571-8',
  'lab_bld_cholesterol':       '2093-3',
  'lab_bld_ldl':               '2089-1',
  'lab_bld_hdl':               '2085-9',
  'lab_bld_triglycerides':     '2571-8',

  // Electrolytes
  'lab_bld_potassium':         '2823-3',
  'lab_bld_sodium':            '2951-2',
  'lab_bld_calcium':           '17861-6',
  'lab_bld_calcium_corrected': '29265-6',
  'lab_bld_phosphate':         '2777-1',
  'lab_bld_magnesium':         '19123-9',
  'lab_bld_bicarbonate':       '1963-8',
  'lab_bld_chloride':          '2075-0',

  // Liver function
  'lab_bld_alt':               '1742-6',
  'lab_bld_ast':               '1920-8',
  'lab_bld_alp':               '6768-6',
  'lab_bld_ggt':               '2324-2',
  'lab_bld_bilirubin':         '1975-2',
  'lab_bld_bilirubin_total':   '1975-2',
  'lab_bld_albumin':           '1751-7',
  'lab_bld_total_protein':     '2885-2',

  // Thyroid
  'lab_bld_tsh':               '3016-3',
  'lab_bld_t4':                '3026-2',
  'lab_bld_t3':                '3053-6',

  // Coagulation
  'lab_bld_inr':               '6301-6',
  'lab_bld_aptt':              '3173-2',

  // Inflammatory
  'lab_bld_crp':               '1988-5',
  'lab_bld_esr':               '4537-7',

  // Bone
  'lab_bld_pth':               '2731-8',
  'lab_bld_vitd':              '1989-3',
  'lab_bld_vitd_25oh':         '1989-3',

  // Uric acid
  'lab_bld_urate':             '3084-1',

  // Vitals / Observations
  'obs_bp_systolic':           '8480-6',
  'obs_bp_diastolic':          '8462-4',
  'obs_hr':                    '8867-4',
  'obs_weight':                '29463-7',
  'obs_height':                '8302-2',
  'obs_bmi':                   '39156-5',
  'obs_waist_circ':            '8280-0',
  'obs_temperature':           '8310-5',
  'obs_resp_rate':             '9279-1',
  'obs_spo2':                  '2708-6',
};

// ---------------------------------------------------------------------------
// Auto-derivation rules
// ---------------------------------------------------------------------------

/**
 * Attempt to auto-derive a FHIR terminology entry from an EADV attribute name.
 *
 * Rules:
 *   icd_XXX     ICD-10 code XXX (uppercase, dots restored)
 *   icpc_XXX    ICPC-2 code XXX (uppercase)
 *   rxnc_XXX    ATC code XXX (uppercase)
 *   lab_/obs_   LOINC lookup from curated map
 *   dmg_gender  Patient.gender
 *   dmg_dob     Patient.birthDate
 */
export function resolveAttribute(
  att: string,
  overrides?: Record<string, TerminologyEntry>
): TerminologyEntry | null {
  const lower = att.toLowerCase();

  // Check user overrides first
  if (overrides && overrides[lower]) {
    return overrides[lower];
  }

  // --- Auto-derive ICD-10 ---
  if (lower.startsWith('icd_')) {
    const code = att.substring(4).toUpperCase().replace(/_/g, '.');
    return {
      system: CODE_SYSTEMS.ICD10,
      code,
      resourceType: 'Condition',
      datePath: 'onsetDateTime',
    };
  }

  // --- Auto-derive ICPC-2 ---
  if (lower.startsWith('icpc_')) {
    const code = att.substring(5).toUpperCase();
    return {
      system: CODE_SYSTEMS.ICPC2,
      code,
      resourceType: 'Condition',
      datePath: 'onsetDateTime',
    };
  }

  // --- Auto-derive ATC (rxnc_ prefix) ---
  if (lower.startsWith('rxnc_')) {
    const code = att.substring(5).toUpperCase();
    return {
      system: CODE_SYSTEMS.ATC,
      code,
      resourceType: 'MedicationRequest',
      datePath: 'authoredOn',
    };
  }

  // --- LOINC lookup for labs and observations ---
  if (lower in LOINC_MAP) {
    const loincCode = LOINC_MAP[lower];
    const isVital = lower.startsWith('obs_');
    return {
      system: CODE_SYSTEMS.LOINC,
      code: loincCode,
      resourceType: 'Observation',
      valuePath: 'valueQuantity.value',
      datePath: 'effectiveDateTime',
    };
  }

  // --- Demographics ---
  if (lower === 'dmg_gender') {
    return {
      system: '',
      code: '',
      resourceType: 'Patient',
      valuePath: 'gender',
    };
  }

  if (lower === 'dmg_dob') {
    return {
      system: '',
      code: '',
      resourceType: 'Patient',
      valuePath: 'birthDate',
      datePath: 'birthDate',
    };
  }

  // --- Smoking status ---
  if (lower.startsWith('status_smoking')) {
    return {
      system: CODE_SYSTEMS.LOINC,
      code: '72166-2',
      resourceType: 'Observation',
      valuePath: 'valueCodeableConcept',
      datePath: 'effectiveDateTime',
    };
  }

  return null;
}

/**
 * Check if a FHIR code matches an EADV attribute pattern.
 * Handles wildcard matching (e.g., icd_E11% matches E11, E11.0, E11.9).
 */
export function codeMatchesPattern(fhirCode: string, eadvCode: string): boolean {
  // Strip the wildcard suffix
  const isWildcard = eadvCode.endsWith('%');
  const pattern = isWildcard ? eadvCode.slice(0, -1) : eadvCode;

  if (isWildcard) {
    return fhirCode.toUpperCase().startsWith(pattern.toUpperCase());
  }

  return fhirCode.toUpperCase() === pattern.toUpperCase();
}
