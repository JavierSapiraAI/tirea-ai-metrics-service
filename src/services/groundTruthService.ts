import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse/sync';
import { createLogger } from '../utils/logger';

const logger = createLogger('GroundTruthService');

export interface GroundTruthDocument {
  document_id: string;
  diagnostico: string[];
  cie10: string[];
  destino_alta: string;
  consultas: string[];
  source: 'sheets' | 'verified';
  version: string;
}

interface GroundTruthCache {
  data: Map<string, GroundTruthDocument>;
  lastUpdated: Date;
  version: string;
}

export class GroundTruthService {
  private s3Client: S3Client;
  private cache: GroundTruthCache | null = null;
  private bucketName: string;
  private cacheTTL: number;

  constructor() {
    this.s3Client = new S3Client({ region: process.env.AWS_REGION || 'eu-west-2' });
    this.bucketName = process.env.GROUND_TRUTH_BUCKET || 'llm-evals-ground-truth-dev';
    this.cacheTTL = parseInt(process.env.GROUND_TRUTH_CACHE_TTL || '900000', 10); // 15 minutes
  }

  /**
   * Get ground truth for a specific document
   */
  async getGroundTruth(documentId: string): Promise<GroundTruthDocument | null> {
    await this.refreshCacheIfNeeded();

    if (!this.cache) {
      logger.warn('Cache is not initialized');
      return null;
    }

    return this.cache.data.get(documentId) || null;
  }

  /**
   * Get all ground truth documents
   */
  async getAllGroundTruth(): Promise<Map<string, GroundTruthDocument>> {
    await this.refreshCacheIfNeeded();
    return this.cache?.data || new Map();
  }

  /**
   * Force refresh the cache
   */
  async refreshCache(): Promise<void> {
    logger.info('Refreshing ground truth cache...');

    // Load both sources (handle errors gracefully for each)
    let sheetsData: GroundTruthDocument[] = [];
    let verifiedData: GroundTruthDocument[] = [];

    // Try to load from Google Sheets
    try {
      sheetsData = await this.loadFromS3('datasets/traces/LATEST');
      logger.info(`Loaded ${sheetsData.length} documents from Google Sheets`);
    } catch (error) {
      logger.warn('Failed to load from Google Sheets, continuing with verified data only', { error });
    }

    // Try to load from verified documents
    try {
      verifiedData = await this.loadFromS3('datasets/traces/LATEST-VERIFIED');
      logger.info(`Loaded ${verifiedData.length} documents from verified sources`);
    } catch (error) {
      logger.warn('Failed to load from verified sources, continuing with sheets data only', { error });
    }

    // If both failed, throw error
    if (sheetsData.length === 0 && verifiedData.length === 0) {
      const error = new Error('Failed to load ground truth from both sources');
      logger.error('Both ground truth sources failed', { error });
      throw error;
    }

    // Merge with precedence (verified > sheets)
    const merged = new Map<string, GroundTruthDocument>();

    // Add sheets data first
    sheetsData.forEach((doc) => {
      merged.set(doc.document_id, doc);
    });

    // Override with verified data
    verifiedData.forEach((doc) => {
      merged.set(doc.document_id, doc);
    });

    this.cache = {
      data: merged,
      lastUpdated: new Date(),
      version: `sheets:${sheetsData.length}+verified:${verifiedData.length}`,
    };

    logger.info(`Ground truth cache refreshed: ${merged.size} documents loaded (${sheetsData.length} from sheets, ${verifiedData.length} verified)`);
  }

  /**
   * Refresh cache if TTL has expired
   */
  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    const cacheAge = this.cache ? now - this.cache.lastUpdated.getTime() : Infinity;

    if (!this.cache || cacheAge > this.cacheTTL) {
      await this.refreshCache();
    }
  }

  /**
   * Load ground truth from S3 (pointer file)
   */
  private async loadFromS3(pointerKey: string): Promise<GroundTruthDocument[]> {
    try {
      // Read the pointer file to get actual data location
      const pointerCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: pointerKey,
      });

      const pointerResponse = await this.s3Client.send(pointerCommand);
      const pointerContent = await pointerResponse.Body?.transformToString();

      if (!pointerContent) {
        logger.warn(`Pointer file ${pointerKey} is empty`);
        return [];
      }

      // Parse pointer file - it can be either plain text path or JSON
      let actualPath: string;
      try {
        const pointerJson = JSON.parse(pointerContent.trim());
        if (pointerJson.s3_uri) {
          // Extract path from s3://bucket-name/path format
          const s3UriMatch = pointerJson.s3_uri.match(/^s3:\/\/[^/]+\/(.+)$/);
          if (s3UriMatch) {
            actualPath = s3UriMatch[1];
            logger.info(`Parsed S3 URI from JSON pointer: ${actualPath}`);
          } else {
            logger.warn(`Invalid s3_uri format in pointer file: ${pointerJson.s3_uri}`);
            return [];
          }
        } else {
          logger.warn(`Pointer JSON missing s3_uri field`);
          return [];
        }
      } catch (e) {
        // Not JSON, treat as plain text path
        actualPath = pointerContent.trim();
        logger.info(`Using plain text path from pointer: ${actualPath}`);
      }

      logger.info(`Loading ground truth from: ${actualPath}`);

      // Load the actual data file
      const dataCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: actualPath,
      });

      const dataResponse = await this.s3Client.send(dataCommand);
      const fileContent = await dataResponse.Body?.transformToString();

      if (!fileContent) {
        logger.warn(`Data file ${actualPath} is empty`);
        return [];
      }

      // Determine file type by extension or content
      const isJSON = actualPath.endsWith('.json');
      const source: 'sheets' | 'verified' = pointerKey.includes('VERIFIED') ? 'verified' : 'sheets';

      if (isJSON) {
        logger.info(`Parsing as JSON (${source})`);
        return this.parseGroundTruthJSON(fileContent, source);
      } else {
        logger.info(`Parsing as CSV (${source})`);
        return this.parseGroundTruthCSV(fileContent, source);
      }
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        logger.warn(`Ground truth file not found: ${pointerKey}`);
        return [];
      }
      logger.error(`Failed to load ground truth from ${pointerKey}`, { error });
      throw error;
    }
  }

  /**
   * Parse ground truth CSV into structured documents
   */
  private parseGroundTruthCSV(csvContent: string, source: 'sheets' | 'verified'): GroundTruthDocument[] {
    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      return records.map((record: any) => ({
        document_id: record.document_id || record.documentId,
        diagnostico: this.parseArrayField(record.diagnostico),
        cie10: this.parseArrayField(record.cie10),
        destino_alta: record.destino_alta || record.destinoAlta || '',
        consultas: this.parseArrayField(record.consultas),
        source,
        version: record.version || 'unknown',
      }));
    } catch (error) {
      logger.error('Failed to parse ground truth CSV', { error });
      throw error;
    }
  }

  /**
   * Parse ground truth JSON into structured documents
   * This handles the format from Tirea-AI verified documents export
   */
  private parseGroundTruthJSON(jsonContent: string, source: 'sheets' | 'verified'): GroundTruthDocument[] {
    try {
      const data = JSON.parse(jsonContent);

      if (!Array.isArray(data)) {
        logger.error('Expected JSON array, got object');
        throw new Error('Invalid JSON format: expected array');
      }

      return data.map((record: any) => {
        // Extract data from Tirea-AI format
        const extractedData = record.extractedData || {};

        // Extract diagnosticos and CIE-10 codes
        const diagnosticos = Array.isArray(extractedData.diagnosticos)
          ? extractedData.diagnosticos.map((d: any) => d.texto_original || '').filter(Boolean)
          : [];

        const cie10Codes = Array.isArray(extractedData.diagnosticos)
          ? extractedData.diagnosticos.map((d: any) => d.codigo_cie10 || d.codigo_cie10_sugerido || '').filter(Boolean)
          : [];

        // Extract destino alta
        const destinoAlta = extractedData.destino_alta?.tipo || extractedData.destino_alta?.destino || '';

        // Extract consultas
        const consultas = Array.isArray(extractedData.continuidad_asistencial?.consultas)
          ? extractedData.continuidad_asistencial.consultas
          : [];

        return {
          document_id: record.document_id || record.id || '',
          diagnostico: diagnosticos,
          cie10: cie10Codes,
          destino_alta: destinoAlta,
          consultas,
          source,
          version: record.metadata?.version || record.version || 'verified',
        };
      });
    } catch (error) {
      logger.error('Failed to parse ground truth JSON', { error });
      throw error;
    }
  }

  /**
   * Parse array field from CSV (handles JSON arrays and pipe-separated strings)
   */
  private parseArrayField(value: string | undefined): string[] {
    if (!value || value.trim() === '') {
      return [];
    }

    try {
      // Try parsing as JSON array first
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Fall back to pipe-separated or comma-separated
      if (value.includes('|')) {
        return value.split('|').map(s => s.trim()).filter(s => s !== '');
      }
      if (value.includes(',')) {
        return value.split(',').map(s => s.trim()).filter(s => s !== '');
      }
      return [value.trim()];
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    if (!this.cache) {
      return {
        size: 0,
        lastUpdated: null,
        version: null,
        ageMs: null,
      };
    }

    return {
      size: this.cache.data.size,
      lastUpdated: this.cache.lastUpdated,
      version: this.cache.version,
      ageMs: Date.now() - this.cache.lastUpdated.getTime(),
    };
  }
}
