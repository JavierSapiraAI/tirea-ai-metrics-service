#!/usr/bin/env python3
import subprocess
import base64
import json

# Langfuse API credentials
PUBLIC_KEY = "pk-lf-eb500457-cacd-4ca7-ada5-3cae4edaadf3"
SECRET_KEY = "sk-lf-c0515ae1-81c2-4d58-a59b-d05ce01a5748"

# Get existing secret
result = subprocess.run(
    "kubectl get secret langfuse-secrets -n langfuse -o json",
    shell=True,
    capture_output=True,
    text=True
)

secret = json.loads(result.stdout)

# Add new keys
secret['data']['public-key'] = base64.b64encode(PUBLIC_KEY.encode()).decode()
secret['data']['secret-key'] = base64.b64encode(SECRET_KEY.encode()).decode()

# Write to temp file
with open('temp-secret.json', 'w') as f:
    json.dump(secret, f)

# Apply the updated secret
result = subprocess.run(
    "kubectl apply -f temp-secret.json",
    shell=True,
    capture_output=True,
    text=True
)

print(result.stdout)
if result.returncode != 0:
    print("Error:", result.stderr)
else:
    print("✓ Secret updated successfully!")

# Clean up
import os
os.remove('temp-secret.json')
