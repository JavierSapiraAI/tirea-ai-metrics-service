output "github_actions_role_arn" {
  description = "ARN of the IAM role for GitHub Actions"
  value       = aws_iam_role.github_actions.arn
}

output "github_actions_role_name" {
  description = "Name of the IAM role for GitHub Actions"
  value       = aws_iam_role.github_actions.name
}

output "metrics_service_irsa_role_arn" {
  description = "ARN of the IAM role for metrics service IRSA"
  value       = aws_iam_role.metrics_service_irsa.arn
}

output "metrics_service_irsa_role_name" {
  description = "Name of the IAM role for metrics service IRSA"
  value       = aws_iam_role.metrics_service_irsa.name
}

output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/metrics-service"
}

output "eks_cluster_name" {
  description = "Name of the EKS cluster"
  value       = var.eks_cluster_name
}

output "k8s_namespace" {
  description = "Kubernetes namespace"
  value       = var.k8s_namespace
}

output "k8s_service_account" {
  description = "Kubernetes service account name"
  value       = var.k8s_service_account
}
