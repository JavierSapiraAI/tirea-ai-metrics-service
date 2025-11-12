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
      logger.debug('Extraction data:', { extraction });
      logger.debug('Ground truth data:', { groundTruth });

      // 1. Diagnostico F1 scores (exact and soft)
      let diagnosticoExact, diagnosticoSoft;
      try {
        diagnosticoExact = calculateExactF1(extraction.diagnostico, groundTruth.diagnostico);
        diagnosticoSoft = calculateSoftF1(extraction.diagnostico, groundTruth.diagnostico);
        logger.debug('Diagnostico metrics calculated', {
          exact: diagnosticoExact.f1,
          soft: diagnosticoSoft.f1,
        });
      } catch (err) {
        logger.error('Failed at diagnostico calculation', { err });
        throw new Error(`Diagnostico calc failed: ${err}`);
      }

      // 2. CIE-10 validation (exact and prefix)
      let cie10Validation;
      try {
        cie10Validation = validateCIE10Codes(extraction.cie10, groundTruth.cie10);
        logger.debug('CIE-10 metrics calculated', {
          exact: cie10Validation.exactAccuracy,
          prefix: cie10Validation.prefixAccuracy,
        });
      } catch (err) {
        logger.error('Failed at CIE-10 calculation', { err });
        throw new Error(`CIE-10 calc failed: ${err}`);
      }

      // 3. Destino alta accuracy
      let destinoResult;
      try {
        destinoResult = calculateFieldAccuracy(extraction.destino_alta, groundTruth.destino_alta);
        logger.debug('Destino alta accuracy calculated', {
          accuracy: destinoResult.accuracy,
          predicted: extraction.destino_alta,
          groundTruth: groundTruth.destino_alta,
        });
      } catch (err) {
        logger.error('Failed at destino alta calculation', { err });
        throw new Error(`Destino alta calc failed: ${err}`);
      }

      // 4. Medicamentos F1 score
      let medicamentosF1;
      try {
        medicamentosF1 = calculateSoftF1(extraction.medicamentos, groundTruth.medicamentos);
        logger.debug('Medicamentos F1 calculated', {
          f1: medicamentosF1.f1,
        });
      } catch (err) {
        logger.error('Failed at medicamentos calculation', { err });
        throw new Error(`Medicamentos calc failed: ${err}`);
      }

      // 5. Consultas F1 score
      let consultasF1;
      try {
        consultasF1 = calculateSoftF1(extraction.consultas, groundTruth.consultas);
        logger.debug('Consultas F1 calculated', {
          f1: consultasF1.f1,
        });
      } catch (err) {
        logger.error('Failed at consultas calculation', { err });
        throw new Error(`Consultas calc failed: ${err}`);
      }

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
    } catch (error) {
      // Direct console logging to bypass logger serialization issues
      console.error(`[MetricsCalculator] ERROR for ${extraction.document_id}:`);
      console.error('Error type:', typeof error);
      console.error('Error instance:', error instanceof Error);
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      } else {
        console.error('Error value:', error);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(`Failed to calculate metrics for document: ${extraction.document_id}`, {
        errorMessage,
        errorStack,
        errorType: typeof error,
        isError: error instanceof Error,
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

      // Transform AI service output format to internal format
      // AI service uses: diagnosticos, destino_alta.tipo, continuidad_asistencial.medicacion_continuada, etc.
      // Internal format uses: diagnostico, destino_alta (string), medicamentos, consultas

      // Extract diagnosticos (plural)
      let diagnostico = [];
      if (Array.isArray(extractedData.diagnosticos)) {
        diagnostico = extractedData.diagnosticos.map((d: any) => d.texto_original || d);
      } else if (Array.isArray(extractedData.diagnostico)) {
        diagnostico = extractedData.diagnostico;
      }

      // Extract CIE-10 codes
      let cie10 = [];
      if (Array.isArray(extractedData.diagnosticos)) {
        cie10 = extractedData.diagnosticos
          .map((d: any) => d.codigo_cie10 || d.codigo_cie10_sugerido)
          .filter((c: string) => c && c !== '');
      } else if (Array.isArray(extractedData.cie10)) {
        cie10 = extractedData.cie10;
      }

      // Extract destino_alta (may be object or string)
      let destino_alta = '';
      if (extractedData.destino_alta) {
        if (typeof extractedData.destino_alta === 'object') {
          destino_alta = extractedData.destino_alta.tipo || '';
        } else {
          destino_alta = String(extractedData.destino_alta);
        }
      }

      // Extract medicamentos (may be nested in continuidad_asistencial)
      let medicamentos = [];
      if (extractedData.continuidad_asistencial?.medicacion_continuada) {
        medicamentos = Array.isArray(extractedData.continuidad_asistencial.medicacion_continuada)
          ? extractedData.continuidad_asistencial.medicacion_continuada
          : [];
      } else if (Array.isArray(extractedData.medicamentos)) {
        medicamentos = extractedData.medicamentos;
      }

      // Extract consultas (may be nested in continuidad_asistencial)
      let consultas = [];
      if (extractedData.continuidad_asistencial?.consultas) {
        consultas = Array.isArray(extractedData.continuidad_asistencial.consultas)
          ? extractedData.continuidad_asistencial.consultas
          : [];
      } else if (Array.isArray(extractedData.consultas)) {
        consultas = extractedData.consultas;
      }

      // Validate at least some data was extracted
      if (diagnostico.length === 0 && cie10.length === 0 && !destino_alta &&
          medicamentos.length === 0 && consultas.length === 0) {
        logger.warn('No valid data could be extracted from trace output');
        return null;
      }

      return {
        document_id: extractedData.document_id || '',
        diagnostico,
        cie10,
        destino_alta,
        medicamentos,
        consultas,
      };
    } catch (error) {
      logger.error('Failed to extract data from trace', { error });
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
