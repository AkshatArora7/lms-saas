#requires -version 5
<#
.SYNOPSIS
  Configure the GitHub repo secrets the "Deploy Web (Vercel)" workflow needs.

.DESCRIPTION
  Sets VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID_WEB and
  VERCEL_PROJECT_ID_ADMIN as Actions secrets on the repo so
  .github/workflows/deploy-web.yml can deploy the apps to Vercel. Until these
  are set the deploy job skips cleanly (it does not fail).

  Get the values from Vercel:
    - Token:    https://vercel.com/account/tokens  (create one)
    - Org ID:   Vercel -> Settings -> General -> "Team/Account ID"
    - Project IDs: each project -> Settings -> General -> "Project ID"
                   (create the projects first; see docs/DEPLOYMENT.md)

.EXAMPLE
  pwsh ./scripts/vercel/set-secrets.ps1 `
    -VercelToken xxx -OrgId team_xxx `
    -ProjectIdWeb prj_web -ProjectIdAdmin prj_admin
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VercelToken,
  [Parameter(Mandatory = $true)][string]$OrgId,
  [Parameter(Mandatory = $true)][string]$ProjectIdWeb,
  [Parameter(Mandatory = $true)][string]$ProjectIdAdmin,
  [string]$Owner = "AkshatArora7",
  [string]$Repo = "lms-saas"
)

$ErrorActionPreference = "Stop"

# Resolve gh executable (PATH or default install location).
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = "C:\Program Files\GitHub CLI\gh.exe" }
if (-not (Test-Path $gh)) { throw "GitHub CLI (gh) not found. Install it first." }

$slug = "$Owner/$Repo"
Write-Host "==> Setting Vercel deploy secrets on $slug" -ForegroundColor Cyan

$secrets = [ordered]@{
  VERCEL_TOKEN            = $VercelToken
  VERCEL_ORG_ID           = $OrgId
  VERCEL_PROJECT_ID_WEB   = $ProjectIdWeb
  VERCEL_PROJECT_ID_ADMIN = $ProjectIdAdmin
}

foreach ($name in $secrets.Keys) {
  $secrets[$name] | & $gh secret set $name --repo $slug --body -
  if ($LASTEXITCODE -ne 0) { throw "Failed to set $name" }
  Write-Host "   set $name" -ForegroundColor Green
}

Write-Host "==> Done. Re-run the 'Deploy Web (Vercel)' workflow (push or re-run the PR checks)." -ForegroundColor Cyan
