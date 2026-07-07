# ── Deploy automation for the Presence stack (L2) ───────────────────────────
# Encodes the hard-won deploy rules so a deploy is one command, not a ritual:
#   • uses supabase-go.exe (supabase.exe segfaults intermittently on deploy)
#   • deploys both functions with --no-verify-jwt (they do their own auth)
#   • VERIFIES the "Deployed Functions" confirmation and fails loudly otherwise
#     (a silent half-deploy is the failure mode we design against)
#
# Usage:
#   pwsh scripts/deploy-presence.ps1 -Env staging
#   pwsh scripts/deploy-presence.ps1 -Env prod
#
# Migrations are applied separately (see docs/presence/OPERATIONS.md — the
# hold-back technique, because remote history only tracks through 0019 and
# 0003-0005 are fenced). This script is functions-only, on purpose.

param(
  [Parameter(Mandatory = $true)][ValidateSet('staging', 'prod')] [string]$Env,
  [string]$Cli = 'C:\Users\edavi\Tools\supabase\supabase-go.exe'
)

$ErrorActionPreference = 'Stop'
$refs = @{ staging = 'wjlpursnwbmlcdwbeowv'; prod = 'qksstlqzbhesadrrofgn' }
$ref = $refs[$Env]
$funcs = @('presence', 'stripe-webhook')

if (-not (Test-Path $Cli)) { throw "supabase-go.exe not found at $Cli" }

Write-Host "Deploying to $Env ($ref) with $Cli" -ForegroundColor Cyan
$failed = @()
foreach ($fn in $funcs) {
  Write-Host "`n--- $fn ---" -ForegroundColor Cyan
  $out = & $Cli functions deploy $fn --no-verify-jwt --project-ref $ref 2>&1 | Out-String
  if ($out -match "Deployed Functions on project $ref`: $fn") {
    Write-Host "OK: $fn deployed" -ForegroundColor Green
  }
  else {
    Write-Host "FAIL: no 'Deployed' confirmation for $fn — possible silent half-deploy" -ForegroundColor Red
    Write-Host ($out | Select-Object -Last 20)
    $failed += $fn
  }
}

if ($failed.Count -gt 0) {
  Write-Host "`nFAILED: $($failed -join ', '). Re-run — do NOT trust a half-deploy." -ForegroundColor Red
  exit 1
}
Write-Host "`nAll functions deployed and verified on $Env." -ForegroundColor Green

# Post-deploy smoke: the public catalog + system health (needs the secret).
$base = "https://$ref.supabase.co/functions/v1/presence"
try {
  $plans = Invoke-RestMethod -Uri "$base/commerce/plans" -Headers @{ Authorization = "Bearer $((& $Cli projects api-keys --project-ref $ref 2>$null | Select-String 'anon' | ForEach-Object { ($_ -split '\|')[1].Trim() } | Select-Object -First 1))" } -TimeoutSec 20
  if ($plans.data.plans.Count -ge 5) { Write-Host "Smoke: /commerce/plans OK ($($plans.data.plans.Count) plans)" -ForegroundColor Green }
}
catch { Write-Host "Smoke: could not verify /commerce/plans (non-fatal): $_" -ForegroundColor Yellow }
