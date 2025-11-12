# EKS Access Entry for GitHub Actions Role
# This allows the GitHub Actions role to access the EKS cluster

resource "aws_eks_access_entry" "github_actions" {
  cluster_name      = var.eks_cluster_name
  principal_arn     = aws_iam_role.github_actions.arn
  kubernetes_groups = []
  type              = "STANDARD"

  tags = {
    Name = "github-actions-metrics-service"
  }
}

# EKS Access Policy Association
# Grants admin access for deployments
resource "aws_eks_access_policy_association" "github_actions_admin" {
  cluster_name  = var.eks_cluster_name
  principal_arn = aws_iam_role.github_actions.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type       = "cluster"
    namespaces = []
  }

  depends_on = [aws_eks_access_entry.github_actions]
}
