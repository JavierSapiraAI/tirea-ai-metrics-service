#!/usr/bin/env python3
"""
Sube ground truth convertido a S3 y reinicia el servicio de métricas
"""

import boto3
import subprocess
from pathlib import Path

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

def main():
    print_header("SUBIDA DE GROUND TRUTH A S3")

    # Configuración
    BUCKET = "llm-evals-ground-truth-dev"
    REGION = "eu-west-2"
    LOCAL_DIR = Path("ground-truth-output")
    VERSION_DIR = LOCAL_DIR / "versions"

    # Verificar archivos locales
    if not LOCAL_DIR.exists():
        print_error(f"Directorio no encontrado: {LOCAL_DIR}")
        print("Ejecuta primero: python convert-ground-truth.py")
        return

    # Obtener la versión más reciente
    versions = sorted([d for d in VERSION_DIR.iterdir() if d.is_dir()], reverse=True)
    if not versions:
        print_error("No se encontraron versiones en ground-truth-output/versions/")
        return

    version = versions[0].name
    version_path = versions[0]

    print(f"Version a subir: {version}")
    print(f"Directorio local: {version_path}")
    print(f"Bucket S3: s3://{BUCKET}/datasets/traces/")

    # Inicializar S3 client
    s3 = boto3.client('s3', region_name=REGION)

    # PASO 1: Subir CSV de ground truth
    print_header("PASO 1: Subiendo Ground Truth CSV")

    csv_local = version_path / "ground-truth.csv"
    csv_s3_key = f"datasets/traces/versions/{version}/ground-truth.csv"

    if not csv_local.exists():
        print_error(f"Archivo no encontrado: {csv_local}")
        return

    print(f"Subiendo: {csv_local} -> s3://{BUCKET}/{csv_s3_key}")

    try:
        s3.upload_file(
            str(csv_local),
            BUCKET,
            csv_s3_key,
            ExtraArgs={'ContentType': 'text/csv'}
        )
        print_success(f"CSV subido: s3://{BUCKET}/{csv_s3_key}")
    except Exception as e:
        print_error(f"Error subiendo CSV: {e}")
        return

    # PASO 2: Subir archivo LATEST pointer
    print_header("PASO 2: Actualizando LATEST Pointer")

    latest_local = LOCAL_DIR / "LATEST"
    latest_s3_key = "datasets/traces/LATEST"

    if not latest_local.exists():
        print_error(f"Archivo LATEST no encontrado: {latest_local}")
        return

    print(f"Subiendo: {latest_local} -> s3://{BUCKET}/{latest_s3_key}")

    try:
        s3.upload_file(
            str(latest_local),
            BUCKET,
            latest_s3_key,
            ExtraArgs={'ContentType': 'application/json'}
        )
        print_success(f"LATEST pointer actualizado: s3://{BUCKET}/{latest_s3_key}")
    except Exception as e:
        print_error(f"Error subiendo LATEST: {e}")
        return

    # PASO 3: Verificar archivos en S3
    print_header("PASO 3: Verificando Archivos en S3")

    try:
        # Verificar CSV
        csv_obj = s3.head_object(Bucket=BUCKET, Key=csv_s3_key)
        csv_size = csv_obj['ContentLength']
        print_success(f"CSV verificado: {csv_size} bytes")

        # Verificar LATEST
        latest_obj = s3.head_object(Bucket=BUCKET, Key=latest_s3_key)
        latest_size = latest_obj['ContentLength']
        print_success(f"LATEST verificado: {latest_size} bytes")

        # Leer contenido de LATEST para mostrar
        latest_content = s3.get_object(Bucket=BUCKET, Key=latest_s3_key)
        latest_json = latest_content['Body'].read().decode('utf-8')
        print(f"\nContenido de LATEST pointer:")
        print(latest_json)

    except Exception as e:
        print_error(f"Error verificando archivos: {e}")
        return

    # PASO 4: Reiniciar pods del servicio de métricas
    print_header("PASO 4: Reiniciando Servicio de Metricas")

    print("Reiniciando pods para recargar ground truth cache...")

    try:
        result = subprocess.run(
            "kubectl rollout restart deployment/metrics-service -n langfuse",
            shell=True,
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            print_success("Deployment reiniciado")
            print(result.stdout)
        else:
            print_error(f"Error reiniciando deployment: {result.stderr}")
            return

        # Esperar a que los pods se reinicien
        print("\nEsperando rollout (max 2 minutos)...")
        result = subprocess.run(
            "kubectl rollout status deployment/metrics-service -n langfuse --timeout=2m",
            shell=True,
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            print_success("Rollout completado")
        else:
            print_warning("Rollout timeout, pero puede estar aun en progreso")

    except Exception as e:
        print_warning(f"No se pudo reiniciar el deployment: {e}")
        print("Puedes reiniciarlo manualmente:")
        print("  kubectl rollout restart deployment/metrics-service -n langfuse")

    # PASO 5: Verificar logs del servicio
    print_header("PASO 5: Verificando Logs del Servicio")

    print("Esperando 10 segundos para que los pods se inicien...")
    import time
    time.sleep(10)

    try:
        result = subprocess.run(
            "kubectl logs -n langfuse -l app=metrics-service --tail=30",
            shell=True,
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            print("Ultimos logs del servicio:")
            print("-" * 80)
            # Buscar lineas relevantes sobre ground truth
            for line in result.stdout.split('\n'):
                if 'ground' in line.lower() or 'cache' in line.lower() or 'document' in line.lower():
                    print(line)
            print("-" * 80)

            # Verificar si se cargo ground truth
            if 'documents loaded' in result.stdout:
                print_success("Ground truth cargado en el servicio!")
            else:
                print_warning("No se ve confirmacion de carga de ground truth en logs")

    except Exception as e:
        print_warning(f"No se pudieron obtener logs: {e}")

    # PASO 6: Resumen final
    print_header("RESUMEN")

    print(f"{Colors.GREEN}[OK]{Colors.NC} Ground truth subido exitosamente a S3")
    print(f"\nArchivos en S3:")
    print(f"  - s3://{BUCKET}/{csv_s3_key}")
    print(f"  - s3://{BUCKET}/{latest_s3_key}")

    print(f"\n{Colors.YELLOW}Siguientes pasos:{Colors.NC}")
    print("  1. Verifica logs del servicio:")
    print("     kubectl logs -n langfuse -l app=metrics-service --tail=50")
    print("\n  2. Verifica salud del servicio:")
    print("     kubectl port-forward -n langfuse svc/metrics-service 3001:3001")
    print("     curl http://localhost:3001/health")
    print("\n  3. El servicio deberia procesar traces automaticamente")
    print("     y calcular metricas en los proximos 60 segundos")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Cancelado por el usuario{Colors.NC}")
    except Exception as e:
        print_error(f"Error inesperado: {e}")
        import traceback
        traceback.print_exc()
