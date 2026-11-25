locals {
  services = [
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "aiplatform.googleapis.com",
    "iamcredentials.googleapis.com", # mints short-lived tokens for impersonation
  ]
  budget_services = var.enable_budget ? ["billingbudgets.googleapis.com"] : []
}

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_project_service" "apis" {
  for_each = toset(concat(local.services, local.budget_services))

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Dedicated identity for the app (use it via impersonation or on a server).
resource "google_service_account" "llm_council" {
  project      = var.project_id
  account_id   = var.service_account_id
  display_name = "GCP LLM Council"
  description  = "Calls Vertex AI models (Gemini, Claude, open models) for the GCP LLM Council app."

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "sa_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.llm_council.email}"
}

# Let the listed people impersonate the service account (scoped to this account only).
resource "google_service_account_iam_member" "impersonators" {
  for_each = toset(var.impersonators)

  service_account_id = google_service_account.llm_council.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

resource "google_project_iam_member" "users_vertex_user" {
  for_each = toset(var.vertex_users)

  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = each.value
}

resource "google_billing_budget" "monthly" {
  count = var.enable_budget ? 1 : 0

  billing_account = var.billing_account
  display_name    = "llm-council monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(floor(var.monthly_budget_amount))
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  lifecycle {
    precondition {
      condition     = var.billing_account != null
      error_message = "billing_account must be set when enable_budget = true."
    }
  }

  depends_on = [google_project_service.apis]
}
