#!/usr/bin/env python3
"""
Fixes the extractDataFromTrace method to handle the actual AI service output format
The AI service returns:
- diagnosticos (plural) instead of diagnostico
- destino_alta as object {tipo, detalles} instead of string
- continuidad_asistencial.consultas instead of consultas
"""

file_path = "src/services/metricsCalculator.ts"

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the extraction logic
old_code = '''      // Validate required fields
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
      };'''

new_code = '''      // Transform AI service output format to internal format
      // AI service uses: diagnosticos, destino_alta.tipo, continuidad_asistencial.consultas
      // Internal format uses: diagnostico, destino_alta (string), consultas

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
          consultas.length === 0) {
        logger.warn('No valid data could be extracted from trace output');
        return null;
      }

      return {
        document_id: extractedData.document_id || '',
        diagnostico,
        cie10,
        destino_alta,
        consultas,
      };'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("[OK] Updated field mapping in metricsCalculator.ts")
else:
    print("[ERROR] Could not find code to replace")
    print("The file may have been modified")
