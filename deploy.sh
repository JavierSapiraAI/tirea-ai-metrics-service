#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-eu-west-2}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_NAME="metrics-service"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CLUSTER_NAME="${CLUSTER_NAME:-langfuse-backoffice-dev}"
NAMESPACE="langfuse"

echo -e "${GREEN}=== Metrics Service Deployment ===${NC}"
echo "AWS Region: $AWS_REGION"
echo "ECR Registry: $ECR_REGISTRY"
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo "Cluster: $CLUSTER_NAME"
echo "Namespace: $NAMESPACE"
echo ""

# Step 1: Build Docker image
echo -e "${YELLOW}Step 1: Building Docker image...${NC}"
docker build -t $IMAGE_NAME:$IMAGE_TAG .
echo -e "${GREEN}✓ Image built successfully${NC}"
echo ""

# Step 2: Tag for ECR
echo -e "${YELLOW}Step 2: Tagging image for ECR...${NC}"
docker tag $IMAGE_NAME:$IMAGE_TAG $ECR_REGISTRY/$IMAGE_NAME:$IMAGE_TAG
echo -e "${GREEN}✓ Image tagged${NC}"
echo ""

# Step 3: Login to ECR
echo -e "${YELLOW}Step 3: Logging in to ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
echo -e "${GREEN}✓ Logged in to ECR${NC}"
echo ""

# Step 4: Create ECR repository if it doesn't exist
echo -e "${YELLOW}Step 4: Ensuring ECR repository exists...${NC}"
aws ecr describe-repositories --repository-names $IMAGE_NAME --region $AWS_REGION > /dev/null 2>&1 || \
  aws ecr create-repository --repository-name $IMAGE_NAME --region $AWS_REGION
echo -e "${GREEN}✓ ECR repository ready${NC}"
echo ""

# Step 5: Push image to ECR
echo -e "${YELLOW}Step 5: Pushing image to ECR...${NC}"
docker push $ECR_REGISTRY/$IMAGE_NAME:$IMAGE_TAG
echo -e "${GREEN}✓ Image pushed to ECR${NC}"
echo ""

# Step 6: Update kubeconfig
echo -e "${YELLOW}Step 6: Updating kubeconfig...${NC}"
aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION
echo -e "${GREEN}✓ Kubeconfig updated${NC}"
echo ""

# Step 7: Create namespace if it doesn't exist
echo -e "${YELLOW}Step 7: Ensuring namespace exists...${NC}"
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✓ Namespace ready${NC}"
echo ""

# Step 8: Update Kubernetes manifests
echo -e "${YELLOW}Step 8: Updating Kubernetes manifests...${NC}"
# Create temporary directory for processed manifests
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Process deployment.yaml
sed "s|\${ECR_REGISTRY}|$ECR_REGISTRY|g" k8s/deployment.yaml > $TEMP_DIR/deployment.yaml

# Get IAM role ARN if not set
if [ -z "$METRICS_SERVICE_IAM_ROLE_ARN" ]; then
  echo "  Looking up IAM role ARN..."
  ROLE_NAME=$(aws iam list-roles --query "Roles[?contains(RoleName, 'metrics-service')].RoleName" --output text | head -n 1)
  if [ -n "$ROLE_NAME" ]; then
    METRICS_SERVICE_IAM_ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
    echo "  Found IAM role: $METRICS_SERVICE_IAM_ROLE_ARN"
  else
    echo -e "${RED}  Warning: IAM role not found. You may need to create it manually.${NC}"
    METRICS_SERVICE_IAM_ROLE_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:role/REPLACE_WITH_ACTUAL_ROLE"
  fi
fi

# Process serviceaccount.yaml
sed "s|\${METRICS_SERVICE_IAM_ROLE_ARN}|$METRICS_SERVICE_IAM_ROLE_ARN|g" k8s/serviceaccount.yaml > $TEMP_DIR/serviceaccount.yaml

# Copy service.yaml as-is
cp k8s/service.yaml $TEMP_DIR/service.yaml

echo -e "${GREEN}✓ Manifests updated${NC}"
echo ""

# Step 9: Create or update Langfuse secrets (if needed)
echo -e "${YELLOW}Step 9: Checking Langfuse secrets...${NC}"
if ! kubectl get secret langfuse-secrets -n $NAMESPACE > /dev/null 2>&1; then
  echo -e "${RED}  Warning: langfuse-secrets not found. You need to create it manually.${NC}"
  echo "  Example:"
  echo "  kubectl create secret generic langfuse-secrets -n $NAMESPACE \\"
  echo "    --from-literal=public-key=pk-lf-xxxxx \\"
  echo "    --from-literal=secret-key=sk-lf-xxxxx"
  echo ""
  read -p "  Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
else
  echo -e "${GREEN}✓ Secrets exist${NC}"
fi
echo ""

# Step 10: Apply Kubernetes manifests
echo -e "${YELLOW}Step 10: Applying Kubernetes manifests...${NC}"
kubectl apply -f $TEMP_DIR/serviceaccount.yaml
kubectl apply -f $TEMP_DIR/deployment.yaml
kubectl apply -f $TEMP_DIR/service.yaml
echo -e "${GREEN}✓ Manifests applied${NC}"
echo ""

# Step 11: Wait for deployment to roll out
echo -e "${YELLOW}Step 11: Waiting for deployment to roll out...${NC}"
kubectl rollout status deployment/metrics-service -n $NAMESPACE --timeout=5m
echo -e "${GREEN}✓ Deployment rolled out successfully${NC}"
echo ""

# Step 12: Verify pods are running
echo -e "${YELLOW}Step 12: Verifying pods...${NC}"
kubectl get pods -n $NAMESPACE -l app=metrics-service
echo ""

# Step 13: Check health
echo -e "${YELLOW}Step 13: Checking service health...${NC}"
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=metrics-service -o jsonpath='{.items[0].metadata.name}')
if [ -n "$POD_NAME" ]; then
  echo "  Pod: $POD_NAME"

  # Wait a bit for the service to start
  sleep 10

  # Check health endpoint
  echo "  Testing health endpoint..."
  kubectl exec -n $NAMESPACE $POD_NAME -- wget -q -O- http://localhost:3001/health | python3 -m json.tool
  echo -e "${GREEN}✓ Service is healthy${NC}"
else
  echo -e "${RED}  No pods found${NC}"
fi
echo ""

# Step 14: Show logs
echo -e "${YELLOW}Step 14: Recent logs:${NC}"
kubectl logs -n $NAMESPACE -l app=metrics-service --tail=20
echo ""

echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  - Monitor logs: kubectl logs -n $NAMESPACE -l app=metrics-service -f"
echo "  - Check health: kubectl port-forward -n $NAMESPACE svc/metrics-service 3001:3001"
echo "  - View stats: curl http://localhost:3001/stats"
echo ""
