variable "project_id" {
  description = "ID of the GCP project where Vertex AI will be used (e.g. my-gcp-project)."
  type        = string
}

variable "region" {
  description = "Default region for regional resources. Vertex AI models are called on the 'global' endpoint by the app; this only affects the provider default."
  type        = string
  default     = "us-central1"
}

variable "service_account_id" {
  description = "Account ID of the service account used by the app."
  type        = string
  default     = "llm-council"
}

variable "impersonators" {
  description = "Principals allowed to impersonate the app's service account (roles/iam.serviceAccountTokenCreator on that account only), e.g. [\"user:you@example.com\"]. The app then calls Vertex AI as the service account."
  type        = list(string)
  default     = []
}

variable "vertex_users" {
  description = "Extra principals granted roles/aiplatform.user, e.g. [\"user:someone@example.com\"]."
  type        = list(string)
  default     = []
}

variable "enable_budget" {
  description = "Create a monthly billing budget alert for the project."
  type        = bool
  default     = false
}

variable "billing_account" {
  description = "Billing account ID (XXXXXX-XXXXXX-XXXXXX). Required only when enable_budget = true."
  type        = string
  default     = null
}

variable "monthly_budget_amount" {
  description = "Monthly budget amount, in the billing account currency."
  type        = number
  default     = 20
}

variable "budget_currency" {
  description = "Currency code of the billing account (e.g. USD, BRL)."
  type        = string
  default     = "USD"
}
