export interface CIE10ValidationResult {
  exactAccuracy: number;
  prefixAccuracy: number;
  exactMatches: number;
  prefixMatches: number;
  totalPredictions: number;
  totalGroundTruth: number;
}

/**
 * Validate CIE-10 codes with both exact and prefix matching
 */
export function validateCIE10Codes(predicted: string[], groundTruth: string[]): CIE10ValidationResult {
  // Normalize codes (uppercase, trim)
  const normalizedPredicted = predicted.map(s => s.toUpperCase().trim());
  const normalizedGroundTruth = groundTruth.map(s => s.toUpperCase().trim());

  let exactMatches = 0;
  let prefixMatches = 0;

  // For each predicted code, check for exact and prefix matches
  for (const pred of normalizedPredicted) {
    // Exact match
    if (normalizedGroundTruth.includes(pred)) {
      exactMatches++;
      prefixMatches++; // Exact match also counts as prefix match
      continue;
    }

    // Prefix match (first 3 characters)
    const predPrefix = pred.substring(0, 3);
    const hasPrefixMatch = normalizedGroundTruth.some(truth => {
      const truthPrefix = truth.substring(0, 3);
      return predPrefix === truthPrefix;
    });

    if (hasPrefixMatch) {
      prefixMatches++;
    }
  }

  // Calculate accuracy scores
  const exactAccuracy = normalizedPredicted.length > 0
    ? exactMatches / normalizedPredicted.length
    : 0;

  const prefixAccuracy = normalizedPredicted.length > 0
    ? prefixMatches / normalizedPredicted.length
    : 0;

  return {
    exactAccuracy: Number(exactAccuracy.toFixed(4)),
    prefixAccuracy: Number(prefixAccuracy.toFixed(4)),
    exactMatches,
    prefixMatches,
    totalPredictions: normalizedPredicted.length,
    totalGroundTruth: normalizedGroundTruth.length,
  };
}

/**
 * Validate if a CIE-10 code has valid format
 */
export function isValidCIE10Format(code: string): boolean {
  // CIE-10 format: Letter + 2-3 digits + optional decimal + optional additional digits
  // Examples: I10, I10.1, E11.9, C50.911
  const cie10Regex = /^[A-Z]\d{2}(\.\d{1,3})?$/;
  return cie10Regex.test(code.toUpperCase().trim());
}

/**
 * Extract CIE-10 prefix (first 3 characters)
 */
export function extractCIE10Prefix(code: string): string {
  return code.toUpperCase().trim().substring(0, 3);
}

/**
 * Group CIE-10 codes by prefix
 */
export function groupByPrefix(codes: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const code of codes) {
    const prefix = extractCIE10Prefix(code);
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(code);
  }

  return groups;
}
