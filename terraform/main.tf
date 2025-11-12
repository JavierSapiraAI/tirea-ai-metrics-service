terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # backend "s3" {
  #   bucket         = "langfuse-backoffice-terraform-state"
  #   key            = "metrics-service/terraform.tfstate"
  #   region         = "eu-west-2"
  #   encrypt        = true
  #   dynamodb_table = "terraform-state-lock"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Tirea-AI-Metrics"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "tirea-ai-metrics-service"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_eks_cluster" "main" {
  name = var.eks_cluster_name
}
