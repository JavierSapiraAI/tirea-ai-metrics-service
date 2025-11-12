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
  medicamentos: string[];
  consultas: string[];
}

export interface MedicalMetrics {
  diagnostico_exact_f1: number;
  diagnostico_soft_f1: number;
  cie10_exact_accuracy: number;
  cie10_prefix_accuracy: number;
  destino_accuracy: number;
  medicamentos_f1: number;
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

      // 4. Medicamentos F1 score
      const medicamentosF1 = calculateSoftF1(extraction.medicamentos, groundTruth.medicamentos);

      logger.debug('Medicamentos F1 calculated', {
        f1: medicamentosF1.f1,
      });

      // 5. Consultas F1 score
      const consultasF1 = calculateSoftF1(extraction.consultas, groundTruth.consultas);

      logger.debug('Consultas F1 calculated', {
        f1: consultasF1.f1,
      });

      // 6. Calculate overall average
      const scores = [
        diagnosticoSoft.f1,
        cie10Validation.prefixAccuracy,
        destinoResult.accuracy,
        medicamentosF1.f1,
        consultasF1.f1,
      ];

      const overallAverage = scores.reduce((sum, score) => sum + score, 0) / scores.length;

      const metrics: MedicalMetrics = {
        diagnostico_exact_f1: diagnosticoExact.f1,
        diagnostico_soft_f1: diagnosticoSoft.f1,
        cie10_exact_accuracy: cie10Validation.exactAccuracy,
        cie10_prefix_accuracy: cie10Validation.prefixAccuracy,
        destino_accuracy: destinoResult.accuracy,
        medicamentos_f1: medicamentosF1.f1,
        consultas_f1: consultasF1.f1,
        overall_average: Number(overallAverage.toFixed(4)),
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
          medicamentos: extraction.medicamentos?.slice(0, 2), // First 2 items for debugging
          consultas: extraction.consultas
        },
        groundTruth: {
          diagnostico: groundTruth.diagnostico,
          cie10: groundTruth.cie10,
          destino_alta: groundTruth.destino_alta,
          medicamentos: groundTruth.medicamentos?.slice(0, 2),
          consultas: groundTruth.consultas
        }
      });
      throw error;
    }
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
      const requiredFields = ['diagnostico', 'cie10', 'destino_alta', 'medicamentos', 'consultas'];
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
        medicamentos: Array.isArray(extractedData.medicamentos) ? extractedData.medicamentos : [],
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

      // Extract medicamentos (from medicacion_continuada)
      const medicamentos = Array.isArray(data.continuidad_asistencial?.medicacion_continuada)
        ? data.continuidad_asistencial.medicacion_continuada
        : [];

      // Extract consultas (from continuidad_asistencial.consultas)
      const consultas = Array.isArray(data.continuidad_asistencial?.consultas)
        ? data.continuidad_asistencial.consultas
        : [];

      logger.debug('Transformed Tirea format', {
        diagnostico_count: diagnostico.length,
        cie10_count: cie10.length,
        destino_alta,
        medicamentos_count: medicamentos.length,
        consultas_count: consultas.length,
      });

      return {
        document_id: data.document_id || '',
        diagnostico,
        cie10,
        destino_alta,
        medicamentos,
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
                    groundTruth.medicamentos.length > 0 ||
                    groundTruth.consultas.length > 0;

    if (!hasData) {
      logger.warn('Ground truth has no data');
      return false;
    }

    return true;
  }
}
