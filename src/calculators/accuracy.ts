export interface AccuracyResult {
  accuracy: number;
  isCorrect: boolean;
  predicted: string;
  groundTruth: string;
}

/**
 * Calculate accuracy for a single field (e.g., destino_alta)
 * Returns 1.0 if match, 0.0 if no match
 */
export function calculateFieldAccuracy(predicted: string, groundTruth: string): AccuracyResult {
  // Normalize strings for comparison (lowercase, trim)
  const normalizedPredicted = predicted.toLowerCase().trim();
  const normalizedGroundTruth = groundTruth.toLowerCase().trim();

  const isCorrect = normalizedPredicted === normalizedGroundTruth;
  const accuracy = isCorrect ? 1.0 : 0.0;

  return {
    accuracy,
    isCorrect,
    predicted,
    groundTruth,
  };
}

/**
 * Calculate accuracy for multiple predictions against ground truth
 */
export function calculateBatchAccuracy(predictions: string[], groundTruthValues: string[]): number {
  if (predictions.length !== groundTruthValues.length) {
    throw new Error('Predictions and ground truth arrays must have the same length');
  }

  if (predictions.length === 0) {
    return 0.0;
  }

  let correctCount = 0;

  for (let i = 0; i < predictions.length; i++) {
    const result = calculateFieldAccuracy(predictions[i], groundTruthValues[i]);
    if (result.isCorrect) {
      correctCount++;
    }
  }

  const accuracy = correctCount / predictions.length;
  return Number(accuracy.toFixed(4));
}

/**
 * Calculate weighted accuracy (some fields might be more important)
 */
export function calculateWeightedAccuracy(
  results: AccuracyResult[],
  weights?: number[]
): number {
  if (results.length === 0) {
    return 0.0;
  }

  // Default: equal weights
  const actualWeights = weights || results.map(() => 1.0);

  if (results.length !== actualWeights.length) {
    throw new Error('Results and weights arrays must have the same length');
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < results.length; i++) {
    weightedSum += results[i].accuracy * actualWeights[i];
    totalWeight += actualWeights[i];
  }

  const accuracy = weightedSum / totalWeight;
  return Number(accuracy.toFixed(4));
}
