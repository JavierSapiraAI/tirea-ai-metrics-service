#!/usr/bin/env python3
"""
Convierte ground truth del formato jerárquico (tirea-doc-hub-poc)
al formato plano (metrics-service) CON VALIDACIÓN COMPLETA
"""

import csv
import json
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any
import hashlib

class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    NC = '\033[0m'

def print_header(text):
    print(f"\n{Colors.BLUE}{'='*80}{Colors.NC}")
    print(f"{Colors.BLUE}{text.center(80)}{Colors.NC}")
    print(f"{Colors.BLUE}{'='*80}{Colors.NC}\n")

def print_success(text):
    print(f"{Colors.GREEN}[OK] {text}{Colors.NC}")

def print_warning(text):
    print(f"{Colors.YELLOW}[WARN] {text}{Colors.NC}")

def print_error(text):
    print(f"{Colors.RED}[ERROR] {text}{Colors.NC}")

def clean_text(text: str) -> str:
    """Limpia texto: remueve comillas, espacios extra, artifacts"""
    if not text:
        return ""

    # Remover smart quotes
    text = text.replace('\u201C', '"').replace('\u201D', '"')
    text = text.replace('\u2018', "'").replace('\u2019', "'")

    # Remover comillas al inicio/final
    text = text.strip().strip('"').strip("'").strip()

    # Normalizar espacios
    text = ' '.join(text.split())

    return text

def parse_hierarchical_csv(csv_path: str) -> List[Dict[str, Any]]:
    """
    Parsea el CSV jerárquico original del formato tirea-doc-hub-poc
    """
    print_header("PASO 1: Parseando CSV Jerárquico Original")

    documents = []
    current_doc = None
    current_section = None

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)

        for row_num, row in enumerate(reader, 1):
            if not row or not any(row):  # Skip empty rows
                continue

            first_col = row[0].strip() if row[0] else ""

            # Clean text early to handle smart quotes in document detection
            first_col_cleaned = clean_text(first_col)

            # Detectar inicio de documento: "Document (N): "filename""
            if first_col_cleaned.startswith("Document ("):
                if current_doc:
                    documents.append(current_doc)

                # Extraer filename (use cleaned text for regex)
                match = re.search(r'Document \(\d+\):\s*["\']?(.+?)["\']?$', first_col_cleaned)
                if match:
                    filename = clean_text(match.group(1))
                    current_doc = {
                        'document_id': filename,
                        'diagnostico': [],
                        'cie10': [],
                        'destino_alta': '',
                        'medicamentos': [],
                        'consultas': [],
                        'raw_rows': []  # Para debugging
                    }
                    current_section = None
                continue

            # Detectar secciones
            if first_col == "Diagnóstico:":
                current_section = 'diagnostico'
                continue
            elif first_col == "CIE-10:":
                current_section = 'cie10'
                continue
            elif first_col == "Destino al alta:":
                current_section = 'destino_alta'
                continue
            elif first_col == "Medicamentos:":
                current_section = 'medicamentos'
                continue
            elif first_col.startswith("Consultas"):  # "Consultas y pruebas:"
                current_section = 'consultas'
                continue

            # Procesar datos de la sección actual
            if current_doc and current_section:
                value = clean_text(first_col)

                # Skip "No" entries (significa vacío)
                if value.upper() == "NO":
                    continue

                # Manejar notación Null (value)
                null_match = re.match(r'Null\s*\((.+?)\)', value, re.IGNORECASE)
                if null_match:
                    value = clean_text(null_match.group(1))

                # Skip empty values
                if not value or value.lower() == 'null':
                    continue

                # Agregar valor a la sección correspondiente
                if current_section == 'destino_alta':
                    current_doc['destino_alta'] = value
                elif current_section in ['diagnostico', 'cie10', 'medicamentos', 'consultas']:
                    if value not in current_doc[current_section]:  # Evitar duplicados
                        current_doc[current_section].append(value)

                # Guardar raw para debugging
                current_doc['raw_rows'].append({
                    'row': row_num,
                    'section': current_section,
                    'value': value
                })

    # Agregar último documento
    if current_doc:
        documents.append(current_doc)

    print_success(f"Parseados {len(documents)} documentos del CSV jerárquico")

    # Mostrar resumen
    for doc in documents:
        print(f"\n  {doc['document_id']}:")
        print(f"    - Diagnósticos: {len(doc['diagnostico'])}")
        print(f"    - CIE-10: {len(doc['cie10'])}")
        print(f"    - Destino: '{doc['destino_alta']}'")
        print(f"    - Medicamentos: {len(doc['medicamentos'])}")
        print(f"    - Consultas: {len(doc['consultas'])}")

    return documents

def convert_to_flat_csv(documents: List[Dict[str, Any]]) -> str:
    """
    Convierte documentos al formato plano CSV para metrics-service
    """
    print_header("PASO 2: Convirtiendo a Formato Plano CSV")

    output = []

    # Header
    header = 'document_id,diagnostico,cie10,destino_alta,medicamentos,consultas,version\n'
    output.append(header)

    version = datetime.now().strftime("%Y.%m.%d")

    for doc in documents:
        # Convertir arrays a JSON strings (formato que espera el servicio)
        row = {
            'document_id': doc['document_id'],
            'diagnostico': json.dumps(doc['diagnostico'], ensure_ascii=False),
            'cie10': json.dumps(doc['cie10'], ensure_ascii=False),
            'destino_alta': doc['destino_alta'],
            'medicamentos': json.dumps(doc['medicamentos'], ensure_ascii=False),
            'consultas': json.dumps(doc['consultas'], ensure_ascii=False),
            'version': version
        }

        # Escapar comillas en CSV
        csv_row = ','.join([
            f'"{str(v).replace(chr(34), chr(34)+chr(34))}"' for v in row.values()
        ])
        output.append(csv_row + '\n')

    csv_content = ''.join(output)

    print_success(f"Convertidos {len(documents)} documentos a formato plano")
    print(f"\n  Total filas: {len(output)} (1 header + {len(documents)} docs)")
    print(f"  Tamaño: {len(csv_content)} bytes")

    return csv_content

def validate_conversion(original_docs: List[Dict[str, Any]], csv_content: str) -> bool:
    """
    VALIDACIÓN CRÍTICA: Verifica que no se perdió información
    """
    print_header("PASO 3: VALIDACIÓN DE CONVERSIÓN (Crítico)")

    # Parsear CSV generado
    lines = csv_content.strip().split('\n')
    reader = csv.DictReader(lines)
    converted_docs = []

    for row in reader:
        doc = {
            'document_id': row['document_id'].strip('"'),
            'diagnostico': json.loads(row['diagnostico'].strip('"').replace('""', '"')),
            'cie10': json.loads(row['cie10'].strip('"').replace('""', '"')),
            'destino_alta': row['destino_alta'].strip('"'),
            'medicamentos': json.loads(row['medicamentos'].strip('"').replace('""', '"')),
            'consultas': json.loads(row['consultas'].strip('"').replace('""', '"'))
        }
        converted_docs.append(doc)

    # Verificar conteo de documentos
    if len(original_docs) != len(converted_docs):
        print_error(f"Conteo de documentos NO coincide: {len(original_docs)} original vs {len(converted_docs)} convertido")
        return False

    print_success(f"Conteo de documentos OK: {len(original_docs)}")

    # Verificar cada documento
    all_valid = True
    discrepancies = []

    for i, (orig, conv) in enumerate(zip(original_docs, converted_docs)):
        doc_issues = []

        # Verificar document_id
        if orig['document_id'] != conv['document_id']:
            doc_issues.append(f"Document ID: '{orig['document_id']}' != '{conv['document_id']}'")

        # Verificar arrays (orden puede variar, pero contenido debe ser igual)
        for field in ['diagnostico', 'cie10', 'medicamentos', 'consultas']:
            orig_set = set(orig[field])
            conv_set = set(conv[field])

            if orig_set != conv_set:
                missing = orig_set - conv_set
                extra = conv_set - orig_set

                if missing:
                    doc_issues.append(f"{field}: FALTA {missing}")
                if extra:
                    doc_issues.append(f"{field}: EXTRA {extra}")

            # Verificar conteo
            if len(orig[field]) != len(conv[field]):
                doc_issues.append(f"{field}: Conteo {len(orig[field])} != {len(conv[field])}")

        # Verificar destino_alta
        if orig['destino_alta'] != conv['destino_alta']:
            doc_issues.append(f"destino_alta: '{orig['destino_alta']}' != '{conv['destino_alta']}'")

        # Reportar issues
        if doc_issues:
            all_valid = False
            discrepancies.append({
                'document': orig['document_id'],
                'issues': doc_issues
            })
            print_error(f"\nDocumento {i+1}: {orig['document_id']}")
            for issue in doc_issues:
                print(f"  - {issue}")
        else:
            print_success(f"Documento {i+1}: {orig['document_id']} - OK")

    print()
    if all_valid:
        print_success("VALIDACIÓN EXITOSA: Toda la información se mantiene")
        return True
    else:
        print_error(f"VALIDACIÓN FALLIDA: Se encontraron {len(discrepancies)} documentos con discrepancias")
        return False

def show_comparison(original_docs: List[Dict[str, Any]], csv_content: str):
    """
    Muestra comparación detallada para revisión manual
    """
    print_header("COMPARACIÓN DETALLADA (Para Revisión Manual)")

    print("\n[Formato Original - Jerárquico]")
    print("-" * 80)
    for doc in original_docs[:2]:  # Mostrar primeros 2 docs como ejemplo
        print(f"\nDocument: {doc['document_id']}")
        print(f"  Diagnóstico: {doc['diagnostico']}")
        print(f"  CIE-10: {doc['cie10']}")
        print(f"  Destino: {doc['destino_alta']}")
        print(f"  Medicamentos: {doc['medicamentos']}")
        print(f"  Consultas: {doc['consultas']}")

    print("\n\n[Formato Convertido - Plano CSV]")
    print("-" * 80)
    lines = csv_content.split('\n')
    for line in lines[:4]:  # Header + 2 docs + blank
        print(line)

    print(f"\n... (showing first 2 of {len(original_docs)} documents)")

def create_latest_pointer(version: str, csv_path: str) -> str:
    """
    Crea el archivo LATEST pointer en formato JSON
    """
    pointer = {
        "version": version,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "s3_uri": f"s3://llm-evals-ground-truth-dev/datasets/traces/versions/{version}/ground-truth.csv",
        "sha256": hashlib.sha256(open(csv_path, 'rb').read()).hexdigest() if Path(csv_path).exists() else None
    }
    return json.dumps(pointer, indent=2)

def main():
    print_header("CONVERSIÓN Y VALIDACIÓN DE GROUND TRUTH")
    print("Convierte CSV jerarquico -> CSV plano con validacion completa\n")

    # Rutas
    POC_REPO = Path("C:/Users/Usuario/Desktop/SegurNeo/tirea-doc-hub-poc")
    INPUT_CSV = POC_REPO / "tests" / "Documents Notes - Traces.csv"
    OUTPUT_DIR = Path("./ground-truth-output")
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Verificar archivo de entrada
    if not INPUT_CSV.exists():
        print_error(f"Archivo no encontrado: {INPUT_CSV}")
        print("\nBusca el archivo en tirea-doc-hub-poc/tests/")
        return

    print(f"Archivo entrada: {INPUT_CSV}")
    print(f"Directorio salida: {OUTPUT_DIR}")

    # PASO 1: Parsear CSV jerárquico
    original_docs = parse_hierarchical_csv(str(INPUT_CSV))

    if not original_docs:
        print_error("No se pudieron parsear documentos del CSV original")
        return

    # PASO 2: Convertir a formato plano
    csv_content = convert_to_flat_csv(original_docs)

    # PASO 3: VALIDAR conversión
    is_valid = validate_conversion(original_docs, csv_content)

    if not is_valid:
        print_error("\n[BLOQUEADO] La conversión no pasó la validación. No se guardará.")
        print("Revisa las discrepancias arriba antes de continuar.")
        return

    # PASO 4: Mostrar comparación
    show_comparison(original_docs, csv_content)

    # PASO 5: Guardar archivos
    print_header("PASO 4: Guardando Archivos de Salida")

    version = datetime.now().strftime("%Y.%m.%d")
    version_dir = OUTPUT_DIR / "versions" / version
    version_dir.mkdir(parents=True, exist_ok=True)

    # Guardar CSV plano
    csv_output_path = version_dir / "ground-truth.csv"
    with open(csv_output_path, 'w', encoding='utf-8', newline='') as f:
        f.write(csv_content)
    print_success(f"CSV plano guardado: {csv_output_path}")

    # Guardar JSON original (para debugging)
    json_output_path = version_dir / "ground-truth-debug.json"
    with open(json_output_path, 'w', encoding='utf-8') as f:
        json.dump(original_docs, f, indent=2, ensure_ascii=False)
    print_success(f"JSON debug guardado: {json_output_path}")

    # Crear LATEST pointer
    pointer_content = create_latest_pointer(version, str(csv_output_path))
    pointer_path = OUTPUT_DIR / "LATEST"
    with open(pointer_path, 'w', encoding='utf-8') as f:
        f.write(pointer_content)
    print_success(f"LATEST pointer creado: {pointer_path}")

    # PASO 6: Resumen final
    print_header("RESUMEN DE CONVERSIÓN")
    print(f"{Colors.GREEN}[OK]{Colors.NC} Conversión completada y validada exitosamente")
    print(f"\n  Documentos procesados: {len(original_docs)}")
    print(f"  Versión: {version}")
    print(f"  Archivos generados:")
    print(f"    - {csv_output_path}")
    print(f"    - {json_output_path}")
    print(f"    - {pointer_path}")

    print(f"\n{Colors.YELLOW}Siguiente paso:{Colors.NC}")
    print(f"  1. Revisa los archivos en: {OUTPUT_DIR}")
    print(f"  2. Si todo se ve bien, ejecuta:")
    print(f"     python upload-ground-truth.py")
    print(f"     (subirá a S3 y actualizará el servicio)")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print_error(f"Error: {e}")
        import traceback
        traceback.print_exc()
