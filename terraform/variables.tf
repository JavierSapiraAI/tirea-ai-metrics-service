variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-2"
}

variable "environment" {
  description = "Environment name (dev, stage, prod)"
  type        = string
  default     = "dev"
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "langfuse-backoffice-dev"
}

variable "github_org" {
  description = "GitHub organization or username"
  type        = string
  default     = "JavierSapiraAI"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "tirea-ai-metrics-service"
}

variable "k8s_namespace" {
  description = "Kubernetes namespace"
  type        = string
  default     = "langfuse"
}

variable "k8s_service_account" {
  description = "Kubernetes service account name"
  type        = string
  default     = "metrics-service"
}

variable "ground_truth_bucket" {
  description = "S3 bucket for ground truth data"
  type        = string
  default     = "llm-evals-ground-truth-dev"
}
