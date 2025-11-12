# IAM Role for Service Account (IRSA)
# This role allows the metrics service pods to access S3 without storing credentials

# Get the OIDC provider for the EKS cluster
data "aws_iam_openid_connect_provider" "eks" {
  url = data.aws_eks_cluster.main.identity[0].oidc[0].issuer
}

locals {
  oidc_provider_arn = data.aws_iam_openid_connect_provider.eks.arn
  oidc_provider_url = replace(data.aws_eks_cluster.main.identity[0].oidc[0].issuer, "https://", "")
}

resource "aws_iam_role" "metrics_service_irsa" {
  name        = "metrics-service-s3-access"
  description = "IAM role for metrics service to access S3 ground truth data"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = local.oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.oidc_provider_url}:aud" = "sts.amazonaws.com"
            "${local.oidc_provider_url}:sub" = "system:serviceaccount:${var.k8s_namespace}:${var.k8s_service_account}"
          }
        }
      }
    ]
  })

  tags = {
    Name = "metrics-service-s3-access"
  }
}

# Policy for S3 read access to ground truth bucket
resource "aws_iam_role_policy" "metrics_service_s3" {
  name = "S3GroundTruthReadPolicy"
  role = aws_iam_role.metrics_service_irsa.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.ground_truth_bucket}",
          "arn:aws:s3:::${var.ground_truth_bucket}/*"
        ]
      }
    ]
  })
}

# Policy for CloudWatch Logs write access
resource "aws_iam_role_policy" "metrics_service_cloudwatch" {
  name = "CloudWatchLogsWritePolicy"
  role = aws_iam_role.metrics_service_irsa.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/eks/${var.eks_cluster_name}/metrics-service*"
      }
    ]
  })
}
