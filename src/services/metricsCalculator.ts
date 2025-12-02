import { calculateExactF1, calculateSoftF1 } from '../calculators/f1Score';
import { validateCIE10Codes } from '../calculators/cie10Validator';
import { calculateFieldAccuracy } from '../calculators/accuracy';
import { GroundTruthDocument } from './groundTruthService';
import { createLogger } from '../utils/logger';

const logger = createLogger('MetricsCalculator');

export interface AIExtraction {
  document_id: string;
  diagnostico: string[];
  cie10: string[];
  destino_alta: string;
  consultas: string[];
}

/**
 * Extended medical metrics with precision/recall for each field
 * This provides granular metrics for better analysis
 */
export interface MedicalMetrics {
  // Diagnostico metrics (exact match)
  diagnostico_exact_precision: number;
  diagnostico_exact_recall: number;
  diagnostico_exact_f1: number;

  // Diagnostico metrics (soft/fuzzy match)
  diagnostico_soft_precision: number;
  diagnostico_soft_recall: number;
  diagnostico_soft_f1: number;

  // CIE-10 metrics
  cie10_exact_accuracy: number;
  cie10_prefix_accuracy: number;
  cie10_exact_matches: number;
  cie10_prefix_matches: number;
  cie10_total_predictions: number;
  cie10_total_ground_truth: number;

  // Destino alta metrics
  destino_accuracy: number;

  // Consultas metrics
  consultas_precision: number;
  consultas_recall: number;
  consultas_f1: number;

  // Overall metrics
  overall_average: number;

  // Confusion matrix counts for debugging
  diagnostico_exact_tp: number;
  diagnostico_exact_fp: number;
  diagnostico_exact_fn: number;
  diagnostico_soft_tp: number;
  diagnostico_soft_fp: number;
  diagnostico_soft_fn: number;
  consultas_tp: number;
  consultas_fp: number;
  consultas_fn: number;
}

/**
 * Legacy metrics interface for backward compatibility
 */
export interface LegacyMedicalMetrics {
  diagnostico_exact_f1: number;
  diagnostico_soft_f1: number;
  cie10_exact_accuracy: number;
  cie10_prefix_accuracy: number;
  destino_accuracy: number;
  consultas_f1: number;
  overall_average: number;
}

export class MetricsCalculator {
  /**
   * Calculate all medical metrics for an AI extraction
   */
  calculateMetrics(extraction: AIExtraction, groundTruth: GroundTruthDocument): MedicalMetrics {
    try {
      logger.info(`Calculating metrics for document: ${extraction.document_id}`);

      // 1. Diagnostico F1 scores (exact and soft)
      const diagnosticoExact = calculateExactF1(extraction.diagnostico, groundTruth.diagnostico);
      const diagnosticoSoft = calculateSoftF1(extraction.diagnostico, groundTruth.diagnostico);

      logger.debug('Diagnostico metrics calculated', {
        exact: diagnosticoExact.f1,
        soft: diagnosticoSoft.f1,
      });

      // 2. CIE-10 validation (exact and prefix)
      const cie10Validation = validateCIE10Codes(extraction.cie10, groundTruth.cie10);

      logger.debug('CIE-10 metrics calculated', {
        exact: cie10Validation.exactAccuracy,
        prefix: cie10Validation.prefixAccuracy,
      });

      // 3. Destino alta accuracy
      const destinoResult = calculateFieldAccuracy(extraction.destino_alta, groundTruth.destino_alta);

      logger.debug('Destino alta accuracy calculated', {
        accuracy: destinoResult.accuracy,
        predicted: extraction.destino_alta,
        groundTruth: groundTruth.destino_alta,
      });

      // 4. Consultas F1 score
      const consultasF1 = calculateSoftF1(extraction.consultas, groundTruth.consultas);

      logger.debug('Consultas F1 calculated', {
        f1: consultasF1.f1,
      });

      // 5. Calculate overall average (4 metrics)
      const scores = [
        diagnosticoSoft.f1,
        cie10Validation.prefixAccuracy,
        destinoResult.accuracy,
        consultasF1.f1,
      ];

      const overallAverage = scores.reduce((sum, score) => sum + score, 0) / scores.length;

      const metrics: MedicalMetrics = {
        // Diagnostico exact metrics
        diagnostico_exact_precision: diagnosticoExact.precision,
        diagnostico_exact_recall: diagnosticoExact.recall,
        diagnostico_exact_f1: diagnosticoExact.f1,

        // Diagnostico soft metrics
        diagnostico_soft_precision: diagnosticoSoft.precision,
        diagnostico_soft_recall: diagnosticoSoft.recall,
        diagnostico_soft_f1: diagnosticoSoft.f1,

        // CIE-10 metrics
        cie10_exact_accuracy: cie10Validation.exactAccuracy,
        cie10_prefix_accuracy: cie10Validation.prefixAccuracy,
        cie10_exact_matches: cie10Validation.exactMatches,
        cie10_prefix_matches: cie10Validation.prefixMatches,
        cie10_total_predictions: cie10Validation.totalPredictions,
        cie10_total_ground_truth: cie10Validation.totalGroundTruth,

        // Destino metrics
        destino_accuracy: destinoResult.accuracy,

        // Consultas metrics
        consultas_precision: consultasF1.precision,
        consultas_recall: consultasF1.recall,
        consultas_f1: consultasF1.f1,

        // Overall
        overall_average: Number(overallAverage.toFixed(4)),

        // Confusion matrix counts
        diagnostico_exact_tp: diagnosticoExact.truePositives,
        diagnostico_exact_fp: diagnosticoExact.falsePositives,
        diagnostico_exact_fn: diagnosticoExact.falseNegatives,
        diagnostico_soft_tp: diagnosticoSoft.truePositives,
        diagnostico_soft_fp: diagnosticoSoft.falsePositives,
        diagnostico_soft_fn: diagnosticoSoft.falseNegatives,
        consultas_tp: consultasF1.truePositives,
        consultas_fp: consultasF1.falsePositives,
        consultas_fn: consultasF1.falseNegatives,
      };

      logger.info(`Metrics calculated successfully for document: ${extraction.document_id}`, {
        overall: metrics.overall_average,
      });

      return metrics;
    } catch (error: any) {
      logger.error(`Failed to calculate metrics for document: ${extraction.document_id}`, {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        extraction: {
          diagnostico: extraction.diagnostico,
          cie10: extraction.cie10,
          destino_alta: extraction.destino_alta,
          consultas: extraction.consultas
        },
        groundTruth: {
          diagnostico: groundTruth.diagnostico,
          cie10: groundTruth.cie10,
          destino_alta: groundTruth.destino_alta,
          consultas: groundTruth.consultas
        }
      });
      throw error;
    }
  }

  /**
   * Convert extended metrics to legacy format for backward compatibility
   */
  toLegacyMetrics(metrics: MedicalMetrics): LegacyMedicalMetrics {
    return {
      diagnostico_exact_f1: metrics.diagnostico_exact_f1,
      diagnostico_soft_f1: metrics.diagnostico_soft_f1,
      cie10_exact_accuracy: metrics.cie10_exact_accuracy,
      cie10_prefix_accuracy: metrics.cie10_prefix_accuracy,
      destino_accuracy: metrics.destino_accuracy,
      consultas_f1: metrics.consultas_f1,
      overall_average: metrics.overall_average,
    };
  }

  /**
   * Extract AI extraction data from Langfuse trace output
   */
  extractDataFromTrace(traceOutput: any): AIExtraction | null {
    try {
      // The trace output should contain the AI extraction results
      // This might be in different formats depending on how the AI service structures its output

      if (!traceOutput || typeof traceOutput !== 'object') {
        logger.warn('Trace output is invalid or empty');
        return null;
      }

      // Try to extract structured data
      let extractedData = traceOutput;

      // If output is nested in a result or data field, unwrap it
      if (traceOutput.result) {
        extractedData = traceOutput.result;
      } else if (traceOutput.data) {
        extractedData = traceOutput.data;
      }

      // Parse if it's a JSON string
      if (typeof extractedData === 'string') {
        try {
          extractedData = JSON.parse(extractedData);
        } catch {
          logger.warn('Failed to parse trace output as JSON');
          return null;
        }
      }

      // Handle Tirea backend format (diagnosticos, destino_alta as object, continuidad_asistencial)
      if (extractedData.diagnosticos || extractedData.continuidad_asistencial) {
        return this.transformTireaFormat(extractedData);
      }

      // Handle legacy/direct format
      // Validate required fields
      const requiredFields = ['diagnostico', 'cie10', 'destino_alta', 'consultas'];
      for (const field of requiredFields) {
        if (!(field in extractedData)) {
          logger.warn(`Missing required field: ${field}`);
          return null;
        }
      }

      return {
        document_id: extractedData.document_id || '',
        diagnostico: Array.isArray(extractedData.diagnostico) ? extractedData.diagnostico : [],
        cie10: Array.isArray(extractedData.cie10) ? extractedData.cie10 : [],
        destino_alta: extractedData.destino_alta || '',
        consultas: Array.isArray(extractedData.consultas) ? extractedData.consultas : [],
      };
    } catch (error) {
      logger.error('Failed to extract data from trace', { error });
      return null;
    }
  }

  /**
   * Transform Tirea backend format to metrics format
   */
  private transformTireaFormat(data: any): AIExtraction | null {
    try {
      // Extract diagnosticos text (from texto_original field)
      const diagnostico = Array.isArray(data.diagnosticos)
        ? data.diagnosticos.map((d: any) => d.texto_original || d).filter((t: any) => typeof t === 'string')
        : [];

      // Extract CIE-10 codes (from codigo_cie10 or codigo_cie10_sugerido)
      const cie10 = Array.isArray(data.diagnosticos)
        ? data.diagnosticos
            .map((d: any) => d.codigo_cie10 || d.codigo_cie10_sugerido)
            .filter((c: any) => c && c !== null)
        : [];

      // Extract destino_alta (from tipo field if object, otherwise as-is)
      const destino_alta = typeof data.destino_alta === 'object'
        ? data.destino_alta.tipo || ''
        : data.destino_alta || '';

      // Extract consultas (from continuidad_asistencial.consultas)
      // Consultas can be objects with 'texto' field or plain strings
      const consultas = Array.isArray(data.continuidad_asistencial?.consultas)
        ? data.continuidad_asistencial.consultas
            .map((c: any) => typeof c === 'object' && c.texto ? c.texto : c)
            .filter((t: any) => typeof t === 'string' && t !== '')
        : [];

      logger.debug('Transformed Tirea format', {
        diagnostico_count: diagnostico.length,
        cie10_count: cie10.length,
        destino_alta,
        consultas_count: consultas.length,
      });

      return {
        document_id: data.document_id || '',
        diagnostico,
        cie10,
        destino_alta,
        consultas,
      };
    } catch (error) {
      logger.error('Failed to transform Tirea format', { error });
      return null;
    }
  }

  /**
   * Validate that extraction and ground truth have compatible data
   */
  validateData(extraction: AIExtraction, groundTruth: GroundTruthDocument): boolean {
    // Check document ID match
    if (extraction.document_id && groundTruth.document_id &&
        extraction.document_id !== groundTruth.document_id) {
      logger.warn('Document ID mismatch', {
        extraction: extraction.document_id,
        groundTruth: groundTruth.document_id,
      });
      return false;
    }

    // Ground truth must have at least some data
    const hasData = groundTruth.diagnostico.length > 0 ||
                    groundTruth.cie10.length > 0 ||
                    groundTruth.destino_alta !== '' ||
                    groundTruth.consultas.length > 0;

    if (!hasData) {
      logger.warn('Ground truth has no data');
      return false;
    }

    return true;
  }
}
