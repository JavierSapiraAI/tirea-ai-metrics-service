# AI Service Error Analysis Report

**Date**: 2025-11-12
**Analyzed By**: Metrics Service Team
**Priority**: HIGH

## Executive Summary

Analysis of 76 traces in Langfuse reveals **55 traces (72.4%) are being skipped** due to two main issues:
1. **Old output format** from October 28 traces (backward compatibility issue)
2. **JavaScript runtime errors** in October 29-30 traces causing empty outputs

## Issue #1: Old Output Format (October 28 traces)

### Problem
Traces from October 28 use a different output structure that wraps data in an `extracted` field:

```json
{
  "success": true,
  "extracted": {
    "destino_alta": {"tipo": "domicilio", "detalles": "null"},
    "processing_info": {...}
  },
  "documentId": "...",
  "processing_method": "..."
}
```

### Impact
- **~30-40% of total traces** affected
- All October 28 traces have `destino_alta` but missing `diagnosticos` and `cie10`
- These traces have medical data but it's not being extracted due to format mismatch

### Root Cause
AI service output format changed between October 28 and current version without maintaining backward compatibility.

### Recommended Fix
Update AI service to maintain consistent output format OR provide migration script to reprocess old traces with current format.

---

## Issue #2: JavaScript Runtime Error (October 29-30 traces)

### Problem
Traces from October 29-30 contain a JavaScript TypeError:

```json
{
  "error": "consulta.toLowerCase is not a function",
  "destino_alta": null,
  "processing_info": {...},
  "diagnosticos_array": [],
  "continuidad_asistencial": null
}
```

### Impact
- **~30-40% of total traces** affected
- Complete processing failure - all fields are null/empty
- Error occurs in "page-by-page-paged-mode" processing method

### Root Cause Analysis

**Error**: `consulta.toLowerCase is not a function`

**Likely Location**: Medical data processing code that handles "consultas" (follow-up appointments)

**Probable Cause**:
1. `consulta` variable is not a string (might be object, array, null, or undefined)
2. Code assumes `consulta` is always a string and calls `.toLowerCase()` without type checking

### Example Code That Would Cause This:
```typescript
// BROKEN CODE (likely current implementation)
const consulta = extractedData.consulta;
const normalizedConsulta = consulta.toLowerCase(); // Error if consulta is not a string

// FIXED CODE (should be)
const consulta = extractedData.consulta;
const normalizedConsulta = typeof consulta === 'string' ? consulta.toLowerCase() : String(consulta).toLowerCase();
```

### Recommended Fix
1. **Immediate**: Add defensive type checking before calling `.toLowerCase()`:
   ```typescript
   if (consulta && typeof consulta === 'string') {
     normalizedConsulta = consulta.toLowerCase();
   }
   ```

2. **Long-term**: Add comprehensive input validation for all extraction fields

3. **Testing**: Add unit tests for edge cases (null, undefined, objects, arrays)

---

## Issue #3: Field Name Inconsistency

### Problem
Different field names used across trace versions:
- `diagnosticos` (current) vs `diagnosticos_array` (October 29-30)
- `extracted.destino_alta` (October 28) vs `destino_alta` (current)

### Impact
- Makes metrics service fragile to AI service changes
- Increases maintenance burden

### Recommended Fix
1. Establish and document canonical output schema
2. Add schema versioning to trace outputs
3. Implement schema migration layer in AI service

---

## Traces Without Generation Output

### Observation
Some traces show: `"No generation observation with output found"`

### Possible Causes
1. AI generation failed or timed out
2. Trace created but generation never completed
3. Output was too large and was not stored

### Recommended Investigation
Check Langfuse trace details for these cases to understand why generation is missing.

---

## Metrics Service Improvements Implemented

To mitigate these issues on the metrics service side, we've implemented:

### 1. Backward Compatibility
- Added handling for `extracted` wrapper (October 28 format)
- Support both `diagnosticos` and `diagnosticos_array` field names

### 2. Robust Extraction
- Accept traces with partial data (e.g., only `destino_alta`)
- Log AI errors but still attempt to extract available fields
- Less strict validation to maximize data recovery

### 3. Enhanced Logging
- Log all AI processing errors with context
- Track which format variants are being processed
- Monitor partial data acceptance rates

---

## Action Items for AI Service Team

### Priority 1 (Critical - Fix Immediately)
- [ ] **Fix `consulta.toLowerCase()` TypeError** in page-by-page processing
  - Add type checking before calling string methods
  - Test with non-string input values

### Priority 2 (High - Fix This Week)
- [ ] **Standardize output schema** across all processing modes
- [ ] **Add output schema version** field to all traces
- [ ] **Document canonical output format** in team wiki/docs

### Priority 3 (Medium - Fix This Sprint)
- [ ] **Add comprehensive input validation** to all extraction functions
- [ ] **Create unit tests** for edge cases (null, undefined, wrong types)
- [ ] **Implement error recovery** - return partial results instead of empty object on errors

### Priority 4 (Low - Technical Debt)
- [ ] **Reprocess October 28-30 traces** with fixed AI service code
- [ ] **Add integration tests** that validate output against schema
- [ ] **Set up automated schema compatibility checks** in CI/CD

---

## Expected Improvement

With these fixes, we estimate:
- **Current**: 27.6% success rate (21/76 traces)
- **After fixes**: 80-90% success rate
  - October 28 traces: Should become processable (~15-20 more traces)
  - October 29-30 traces: Should become processable (~20-25 more traces)
  - Net improvement: +50-60 percentage points

---

## Contact

For questions about this report:
- **Metrics Service Team**: [metrics-team@tirea.com]
- **Report Location**: `tirea-ai-metrics-service/AI_SERVICE_ERROR_REPORT.md`
- **CloudWatch Dashboard**: https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2#dashboards:name=LangfuseMetricsService-dev
