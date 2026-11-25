output "project_id" {
  value = var.project_id
}

output "project_number" {
  value = data.google_project.this.number
}

output "service_account_email" {
  description = "Service account the app can impersonate to call Vertex AI."
  value       = google_service_account.llm_council.email
}

output "env_snippet" {
  description = "Lines to add to the app's .env."
  value       = "GCP_PROJECT_ID=${var.project_id}\nGCP_LOCATION=global\nGCP_IMPERSONATE_SERVICE_ACCOUNT=${google_service_account.llm_council.email}"
}
