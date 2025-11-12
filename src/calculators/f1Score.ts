import { compareTwoStrings } from 'string-similarity';

export interface F1ScoreResult {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

/**
 * Safely converts array items to strings, filtering out invalid values
 */
function toStringArray(arr: any[]): string[] {
  return arr
    .filter(item => item != null) // Remove null/undefined
    .map(item => {
      if (typeof item === 'string') {
        return item;
      }
      if (typeof item === 'object') {
        return JSON.stringify(item);
      }
      return String(item);
    })
    .map(s => s.toLowerCase().trim())
    .filter(s => s.length > 0); // Remove empty strings
}

/**
 * Calculate F1 score with exact matching
 */
export function calculateExactF1(predicted: string[], groundTruth: string[]): F1ScoreResult {
  // Defensive type validation
  if (!Array.isArray(predicted)) {
    throw new TypeError(`calculateExactF1: predicted must be an array, got ${typeof predicted}: ${JSON.stringify(predicted).substring(0, 200)}`);
  }
  if (!Array.isArray(groundTruth)) {
    throw new TypeError(`calculateExactF1: groundTruth must be an array, got ${typeof groundTruth}: ${JSON.stringify(groundTruth).substring(0, 200)}`);
  }

  // Normalize strings for comparison (lowercase, trim)
  const normalizedPredicted = toStringArray(predicted);
  const normalizedGroundTruth = toStringArray(groundTruth);

  // Calculate true positives (exact matches)
  const truePositives = normalizedPredicted.filter(p =>
    normalizedGroundTruth.includes(p)
  ).length;

  const falsePositives = normalizedPredicted.length - truePositives;
  const falseNegatives = normalizedGroundTruth.length - truePositives;

  return calculateF1Metrics(truePositives, falsePositives, falseNegatives);
}

/**
 * Calculate F1 score with soft (fuzzy) matching
 * Uses string similarity with a threshold of 0.8 (80% similarity)
 */
export function calculateSoftF1(predicted: string[], groundTruth: string[], threshold: number = 0.8): F1ScoreResult {
  // Defensive type validation
  if (!Array.isArray(predicted)) {
    throw new TypeError(`calculateSoftF1: predicted must be an array, got ${typeof predicted}: ${JSON.stringify(predicted).substring(0, 200)}`);
  }
  if (!Array.isArray(groundTruth)) {
    throw new TypeError(`calculateSoftF1: groundTruth must be an array, got ${typeof groundTruth}: ${JSON.stringify(groundTruth).substring(0, 200)}`);
  }

  // Normalize strings
  const normalizedPredicted = toStringArray(predicted);
  const normalizedGroundTruth = toStringArray(groundTruth);

  let truePositives = 0;
  const matchedGroundTruth = new Set<number>();

  // For each predicted value, find the best match in ground truth
  for (const pred of normalizedPredicted) {
    let bestMatch = -1;
    let bestSimilarity = 0;

    normalizedGroundTruth.forEach((truth, index) => {
      if (matchedGroundTruth.has(index)) return; // Already matched

      const similarity = compareTwoStrings(pred, truth);
      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatch = index;
      }
    });

    if (bestMatch >= 0) {
      truePositives++;
      matchedGroundTruth.add(bestMatch);
    }
  }

  const falsePositives = normalizedPredicted.length - truePositives;
  const falseNegatives = normalizedGroundTruth.length - truePositives;

  return calculateF1Metrics(truePositives, falsePositives, falseNegatives);
}

/**
 * Calculate precision, recall, and F1 score from confusion matrix values
 */
function calculateF1Metrics(
  truePositives: number,
  falsePositives: number,
  falseNegatives: number
): F1ScoreResult {
  // Handle edge cases
  if (truePositives === 0 && falsePositives === 0 && falseNegatives === 0) {
    // Perfect score: no predictions and no ground truth
    return {
      precision: 1.0,
      recall: 1.0,
      f1: 1.0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
    };
  }

  if (truePositives === 0) {
    // No correct predictions
    return {
      precision: 0.0,
      recall: 0.0,
      f1: 0.0,
      truePositives: 0,
      falsePositives,
      falseNegatives,
    };
  }

  const precision = truePositives / (truePositives + falsePositives);
  const recall = truePositives / (truePositives + falseNegatives);
  const f1 = 2 * (precision * recall) / (precision + recall);

  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    truePositives,
    falsePositives,
    falseNegatives,
  };
}

/**
 * Calculate average F1 score across multiple fields
 */
export function calculateAverageF1(f1Scores: number[]): number {
  if (f1Scores.length === 0) return 0;
  const sum = f1Scores.reduce((acc, score) => acc + score, 0);
  return Number((sum / f1Scores.length).toFixed(4));
}
