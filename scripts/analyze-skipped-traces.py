#!/usr/bin/env python3
"""
Analyze skipped traces to understand why they don't have extractable data
"""

import os
import requests
import json

def analyze_traces():
    # Get Langfuse credentials from environment
    langfuse_host = os.environ.get('LANGFUSE_HOST', 'http://langfuse-eks.saludneo.com')
    public_key = os.environ.get('LANGFUSE_PUBLIC_KEY', 'pk-lf-eb500457-cacd-4ca7-ada5-3cae4edaadf3')
    secret_key = os.environ.get('LANGFUSE_SECRET_KEY', 'sk-lf-c0515ae1-81c2-4d58-a59b-d05ce01a5748')

    print(f"\n=== Analyzing Skipped Traces ===")
    print(f"Langfuse Host: {langfuse_host}\n")

    # Fetch recent traces
    url = f"{langfuse_host}/api/public/traces"
    auth = (public_key, secret_key)

    try:
        response = requests.get(f"{url}?page=1&limit=10", auth=auth, timeout=10)
        response.raise_for_status()
        traces = response.json().get('data', [])

        print(f"Fetched {len(traces)} recent traces\n")

        success_count = 0
        skip_count = 0

        for i, trace in enumerate(traces[:10], 1):
            trace_id = trace.get('id', 'unknown')
            trace_name = trace.get('name', 'unknown')
            output = trace.get('output')

            print(f"--- Trace {i}: {trace_name} ---")
            print(f"ID: {trace_id}")
            print(f"Has output: {output is not None}")

            if output:
                # Check if it would be extractable
                extractable = check_if_extractable(output)
                if extractable:
                    success_count += 1
                    print(f"Status: [EXTRACTABLE]")
                    print(f"Output structure: {get_structure_summary(output)}")
                else:
                    skip_count += 1
                    print(f"Status: [WOULD BE SKIPPED]")
                    print(f"Output type: {type(output).__name__}")
                    if isinstance(output, dict):
                        print(f"Output keys: {list(output.keys())[:10]}")
                    elif isinstance(output, str):
                        print(f"Output length: {len(output)} chars")
                        print(f"Output preview: {output[:200]}")
            else:
                skip_count += 1
                print(f"Status: [NO OUTPUT]")

            print()

        print(f"\nSummary:")
        print(f"  Extractable: {success_count}/10")
        print(f"  Would skip: {skip_count}/10")

    except Exception as e:
        print(f"[ERROR] Failed to fetch traces: {e}")
        import traceback
        traceback.print_exc()

def check_if_extractable(output):
    """Check if trace output would be extractable based on metricsCalculator logic"""
    try:
        data = output

        # Unwrap if nested
        if isinstance(data, dict):
            if 'result' in data:
                data = data['result']
            elif 'data' in data:
                data = data['data']

        # Parse JSON string
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                return False

        if not isinstance(data, dict):
            return False

        # Check for extractable fields
        has_diagnostico = bool(data.get('diagnosticos') or data.get('diagnostico'))
        has_cie10 = bool(
            (isinstance(data.get('diagnosticos'), list) and
             any(d.get('codigo_cie10') or d.get('codigo_cie10_sugerido') for d in data.get('diagnosticos', []))) or
            data.get('cie10')
        )
        has_destino = bool(data.get('destino_alta'))
        has_consultas = bool(
            data.get('continuidad_asistencial', {}).get('consultas') or
            data.get('consultas')
        )

        # At least one field must be present
        return has_diagnostico or has_cie10 or has_destino or has_consultas

    except Exception as e:
        return False

def get_structure_summary(output):
    """Get a summary of the output structure"""
    try:
        data = output

        # Unwrap if nested
        if isinstance(data, dict):
            if 'result' in data:
                data = data['result']
            elif 'data' in data:
                data = data['data']

        # Parse JSON string
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                return "Unparseable string"

        if isinstance(data, dict):
            keys = list(data.keys())[:10]
            return f"dict with keys: {keys}"
        elif isinstance(data, list):
            return f"list with {len(data)} items"
        else:
            return f"{type(data).__name__}"

    except:
        return "Unknown structure"

if __name__ == "__main__":
    analyze_traces()
