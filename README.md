# Metrics Service

Medical metrics calculation service for Langfuse traces. Calculates quality metrics (F1 scores, accuracy) by comparing AI extractions against ground truth data from S3.

## Features

- **Medical Metrics Calculation**: 7 medical-specific quality scores
  - Diagnostico F1 (exact and soft matching)
  - CIE-10 Code Accuracy (exact and prefix matching)
  - Destino Alta Accuracy
  - Medicamentos F1
  - Consultas F1
  - Overall Average Score

- **Ground Truth Integration**: Loads and caches ground truth from S3
- **Automatic Processing**: Polls Langfuse API for unprocessed traces
- **High Availability**: 2 replicas with anti-affinity
- **Observability**: Health checks, readiness probes, structured logging

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│   Langfuse API  │◄─────┤ Metrics Service  ├─────►│     S3      │
│   (Traces)      │      │  - Poll traces   │      │ Ground Truth│
└─────────────────┘      │  - Calculate     │      └─────────────┘
                         │  - Push scores   │
                         └──────────────────┘
```

## Prerequisites

- Node.js 20+
- Docker
- AWS CLI configured
- kubectl access to EKS cluster
- IAM role with S3 read permissions

## Environment Variables

```bash
# Langfuse Configuration
LANGFUSE_URL=http://langfuse-web:3000
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxx

# AWS Configuration
AWS_REGION=eu-west-2
GROUND_TRUTH_BUCKET=llm-evals-ground-truth-dev

# Service Configuration
POLL_INTERVAL=60000              # 60 seconds
GROUND_TRUTH_CACHE_TTL=900000    # 15 minutes
LOG_LEVEL=info
PORT=3001

# Processing Configuration
MAX_TRACES_PER_POLL=100
RETRY_ATTEMPTS=3
RETRY_DELAY=1000
```

## Development

### Install Dependencies

```bash
cd services/metrics-service
npm install
```

### Run Locally

```bash
# Set environment variables
export LANGFUSE_URL=http://localhost:3000
export LANGFUSE_PUBLIC_KEY=pk-lf-xxxxx
export LANGFUSE_SECRET_KEY=sk-lf-xxxxx
export GROUND_TRUTH_BUCKET=llm-evals-ground-truth-dev
export AWS_REGION=eu-west-2

# Run in development mode
npm run dev
```

### Run Tests

```bash
npm test
```

### Build

```bash
npm run build
```

## Deployment

### 1. Build Docker Image

```bash
# Set ECR registry
export ECR_REGISTRY=123456789012.dkr.ecr.eu-west-2.amazonaws.com

# Build image
docker build -t metrics-service:latest .

# Tag for ECR
docker tag metrics-service:latest $ECR_REGISTRY/metrics-service:latest
```

### 2. Push to ECR

```bash
# Login to ECR
aws ecr get-login-password --region eu-west-2 | docker login --username AWS --password-stdin $ECR_REGISTRY

# Create repository if it doesn't exist
aws ecr create-repository --repository-name metrics-service --region eu-west-2 || true

# Push image
docker push $ECR_REGISTRY/metrics-service:latest
```

### 3. Create IAM Role for Service Account

```bash
# Create IAM policy for S3 access
aws iam create-policy \
  --policy-name MetricsServiceS3Access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::llm-evals-ground-truth-dev",
          "arn:aws:s3:::llm-evals-ground-truth-dev/*"
        ]
      }
    ]
  }'

# Create IAM role for EKS service account (use eksctl or Terraform)
eksctl create iamserviceaccount \
  --cluster=langfuse-backoffice-dev \
  --namespace=langfuse \
  --name=metrics-service \
  --attach-policy-arn=arn:aws:iam::YOUR_ACCOUNT:policy/MetricsServiceS3Access \
  --approve
```

### 4. Update Kubernetes Manifests

```bash
# Update deployment.yaml with ECR registry
export ECR_REGISTRY=123456789012.dkr.ecr.eu-west-2.amazonaws.com
sed -i "s|\${ECR_REGISTRY}|$ECR_REGISTRY|g" k8s/deployment.yaml

# Update serviceaccount.yaml with IAM role ARN
export METRICS_SERVICE_IAM_ROLE_ARN=$(aws iam get-role --role-name eksctl-langfuse-backoffice-dev-addon-iamserviceaccount-langfuse-metrics-service-Role1 --query 'Role.Arn' --output text)
sed -i "s|\${METRICS_SERVICE_IAM_ROLE_ARN}|$METRICS_SERVICE_IAM_ROLE_ARN|g" k8s/serviceaccount.yaml
```

### 5. Deploy to EKS

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/serviceaccount.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Verify deployment
kubectl get pods -n langfuse -l app=metrics-service
kubectl logs -n langfuse -l app=metrics-service --tail=100 -f
```

### 6. Verify Health

```bash
# Port-forward to service
kubectl port-forward -n langfuse svc/metrics-service 3001:3001

# Check health
curl http://localhost:3001/health
curl http://localhost:3001/ready
curl http://localhost:3001/stats
```

## Monitoring

### Health Endpoints

- **`GET /health`**: Overall health status with cache stats
- **`GET /ready`**: Readiness probe (checks if processor is running and cache is loaded)
- **`GET /live`**: Liveness probe (simple alive check)
- **`GET /stats`**: Detailed statistics about processing

### Logs

```bash
# View logs from all replicas
kubectl logs -n langfuse -l app=metrics-service --tail=100 -f

# View logs from specific pod
kubectl logs -n langfuse metrics-service-xxxxx-xxxxx -f
```

### CloudWatch Logs

Logs are automatically sent to CloudWatch Logs under:
- Log Group: `/aws/eks/langfuse-backoffice-dev/langfuse`
- Log Stream: `metrics-service-*`

## Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod -n langfuse metrics-service-xxxxx-xxxxx

# Check logs
kubectl logs -n langfuse metrics-service-xxxxx-xxxxx
```

### S3 Access Issues

```bash
# Verify IAM role is attached
kubectl describe serviceaccount -n langfuse metrics-service

# Test S3 access from pod
kubectl exec -n langfuse metrics-service-xxxxx-xxxxx -- aws s3 ls s3://llm-evals-ground-truth-dev/
```

### Langfuse Connection Issues

```bash
# Test Langfuse API from pod
kubectl exec -n langfuse metrics-service-xxxxx-xxxxx -- curl -v http://langfuse-web:3000/api/public/health
```

### Ground Truth Cache Not Loading

```bash
# Check cache stats
curl http://localhost:3001/stats

# Verify S3 bucket structure
aws s3 ls s3://llm-evals-ground-truth-dev/datasets/traces/ --recursive
```

## Maintenance

### Update Docker Image

```bash
# Build and push new image
docker build -t $ECR_REGISTRY/metrics-service:latest .
docker push $ECR_REGISTRY/metrics-service:latest

# Rollout restart
kubectl rollout restart deployment/metrics-service -n langfuse

# Monitor rollout
kubectl rollout status deployment/metrics-service -n langfuse
```

### Scale Replicas

```bash
# Scale to 3 replicas
kubectl scale deployment/metrics-service -n langfuse --replicas=3

# Verify scaling
kubectl get pods -n langfuse -l app=metrics-service
```

### Update Environment Variables

```bash
# Edit deployment
kubectl edit deployment/metrics-service -n langfuse

# Or apply updated manifest
kubectl apply -f k8s/deployment.yaml
```

## Architecture Decisions

### Why Separate Service?

- **Performance**: Complex medical metrics don't slow down API responses
- **Scalability**: Independent scaling from Tirea-AI backend
- **Reusability**: Centralized metrics logic for all AI models
- **Maintainability**: Easier to update metrics algorithms

### Why Polling vs Events?

- **Simplicity**: No need for message queues or event streams
- **Reliability**: Built-in retry logic
- **Cost**: Lower infrastructure costs
- **Flexibility**: Easy to adjust polling frequency

### Why Cache Ground Truth?

- **Performance**: Avoid S3 API calls on every trace
- **Cost**: Reduce S3 request costs
- **Reliability**: Service continues working during S3 outages

## License

UNLICENSED - Internal Tirea Use Only
