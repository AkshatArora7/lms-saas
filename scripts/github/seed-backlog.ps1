#requires -version 5
<#
.SYNOPSIS
  Seed GitHub labels, milestones and issues (epics + user stories/tasks/bugs)
  for the LMS project from docs/backlog/backlog.json.

.DESCRIPTION
  Idempotent by issue title: re-running will not duplicate issues. Creates:
    - labels (type/*, priority/*, area/*)
    - milestones (M0..M5)
    - one "EPIC" issue per epic, plus one issue per story/task/bug/spike
    - epic issues get a task-list linking their child issues
  Optionally creates a Project (v2) board and adds every issue to it — this
  requires the 'project' + 'read:project' token scopes. If they are missing the
  script skips the board step and prints how to enable it.

.EXAMPLE
  pwsh ./scripts/github/seed-backlog.ps1 -Owner AkshatArora7 -Repo lms-saas -CreateProject
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$BacklogPath = "$PSScriptRoot/../../docs/backlog/backlog.json",
  [switch]$CreateProject,
  [string]$ProjectTitle = "LMS Delivery"
)

$ErrorActionPreference = "Stop"

# Resolve gh executable (PATH or default install location).
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = "C:\Program Files\GitHub CLI\gh.exe" }
if (-not (Test-Path $gh)) { throw "GitHub CLI (gh) not found. Install it first." }

$slug = "$Owner/$Repo"
Write-Host "==> Seeding $slug from $BacklogPath" -ForegroundColor Cyan
$backlog = Get-Content -Raw -Path $BacklogPath | ConvertFrom-Json

function Invoke-Gh {
  param([string[]]$GhArgs, [switch]$IgnoreError)
  $out = & $gh @GhArgs 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $IgnoreError) { throw "gh $($GhArgs -join ' ')`n$out" }
  return $out
}

# ---------------------------------------------------------------- labels
Write-Host "==> Labels" -ForegroundColor Cyan
foreach ($l in $backlog.labels) {
  Invoke-Gh @("label", "create", $l.name, "--repo", $slug, "--color", $l.color,
    "--description", $l.description, "--force") -IgnoreError | Out-Null
  Write-Host "   label $($l.name)"
}

# ------------------------------------------------------------ milestones
Write-Host "==> Milestones" -ForegroundColor Cyan
$existingMs = Invoke-Gh @("api", "repos/$slug/milestones?state=all&per_page=100") | ConvertFrom-Json
$msMap = @{}
foreach ($m in $existingMs) { $msMap[$m.title] = $m.number }
foreach ($m in $backlog.milestones) {
  if (-not $msMap.ContainsKey($m.title)) {
    $created = Invoke-Gh @("api", "repos/$slug/milestones", "-f", "title=$($m.title)",
      "-f", "description=$($m.description)") | ConvertFrom-Json
    $msMap[$m.title] = $created.number
    Write-Host "   created milestone $($m.title) (#$($created.number))"
  } else {
    Write-Host "   exists  milestone $($m.title) (#$($msMap[$m.title]))"
  }
}

# --------------------------------------------------- existing issue index
Write-Host "==> Indexing existing issues" -ForegroundColor Cyan
$existing = Invoke-Gh @("issue", "list", "--repo", $slug, "--state", "all",
  "--limit", "1000", "--json", "number,title") | ConvertFrom-Json
$titleToNumber = @{}
foreach ($i in $existing) { $titleToNumber[$i.title] = $i.number }

function Ensure-Issue {
  param([string]$Title, [string]$Body, [string[]]$Labels, [string]$Milestone)
  if ($titleToNumber.ContainsKey($Title)) {
    Write-Host "   exists  #$($titleToNumber[$Title]) $Title"
    return $titleToNumber[$Title]
  }
  $a = @("issue", "create", "--repo", $slug, "--title", $Title, "--body", $Body)
  foreach ($lb in $Labels) { $a += @("--label", $lb) }
  if ($Milestone) { $a += @("--milestone", $Milestone) }
  $url = (Invoke-Gh $a).Trim()
  $num = [int]($url -split "/")[-1]
  $titleToNumber[$Title] = $num
  Write-Host "   created #$num $Title"
  return $num
}

function Build-StoryBody {
  param($s, [string]$EpicTitle, [int]$EpicNumber)
  $sb = New-Object System.Text.StringBuilder
  if ($s.as_a) {
    [void]$sb.AppendLine("**User story**")
    [void]$sb.AppendLine("As a **$($s.as_a)**, I want $($s.i_want), so that $($s.so_that).")
    [void]$sb.AppendLine()
  }
  if ($s.ac) {
    [void]$sb.AppendLine("**Acceptance criteria**")
    foreach ($c in $s.ac) { [void]$sb.AppendLine("- [ ] $c") }
    [void]$sb.AppendLine()
  }
  [void]$sb.AppendLine("**Epic:** #$EpicNumber — $EpicTitle")
  $pts = if ($s.points) { "$($s.points) pts" } else { "—" }
  [void]$sb.AppendLine("**Priority:** $($s.priority) · **Estimate:** $pts")
  return $sb.ToString()
}

# ----------------------------------------------------------- epics+stories
$allIssueNumbers = New-Object System.Collections.Generic.List[int]
foreach ($epic in $backlog.epics) {
  Write-Host "==> $($epic.key): $($epic.title)" -ForegroundColor Cyan

  # Epic issue first (so children can link to it).
  $epicLabels = @("type/epic") + $epic.labels
  $epicBody = "$($epic.summary)`n`n_Child stories are tracked in the checklist below._"
  $epicNum = Ensure-Issue -Title $epic.title -Body $epicBody -Labels $epicLabels -Milestone $epic.milestone
  $allIssueNumbers.Add($epicNum)

  $childNumbers = New-Object System.Collections.Generic.List[int]
  foreach ($s in $epic.stories) {
    $labels = @("type/$($s.type)", "priority/$($s.priority)") + $epic.labels
    $body = Build-StoryBody -s $s -EpicTitle $epic.title -EpicNumber $epicNum
    $num = Ensure-Issue -Title $s.title -Body $body -Labels $labels -Milestone $epic.milestone
    $childNumbers.Add($num)
    $allIssueNumbers.Add($num)
  }

  # Refresh the epic body with a task list of its children.
  $checklist = ($childNumbers | ForEach-Object { "- [ ] #$_" }) -join "`n"
  $newBody = "$($epic.summary)`n`n### Stories`n$checklist"
  Invoke-Gh @("issue", "edit", "$epicNum", "--repo", $slug, "--body", $newBody) | Out-Null
}

Write-Host ""
Write-Host "==> Created/verified $($allIssueNumbers.Count) issues across $($backlog.epics.Count) epics." -ForegroundColor Green

# --------------------------------------------------------------- project
if ($CreateProject) {
  Write-Host "==> Project board" -ForegroundColor Cyan
  $scopes = Invoke-Gh @("auth", "status") -IgnoreError
  if ("$scopes" -notmatch "project") {
    Write-Warning "Token is missing the 'project' scope, so the Project (v2) board cannot be created via the API."
    Write-Host  "   To enable it, run:  gh auth refresh -s project,read:project" -ForegroundColor Yellow
    Write-Host  "   Or create the board in the UI and turn on the built-in 'Auto-add to project' workflow" -ForegroundColor Yellow
    Write-Host  "   so all repo issues populate automatically." -ForegroundColor Yellow
  } else {
    $proj = Invoke-Gh @("project", "create", "--owner", $Owner, "--title", $ProjectTitle, "--format", "json") | ConvertFrom-Json
    Write-Host "   created project '$ProjectTitle' (number $($proj.number))"
    foreach ($n in $allIssueNumbers) {
      Invoke-Gh @("project", "item-add", "$($proj.number)", "--owner", $Owner,
        "--url", "https://github.com/$slug/issues/$n") -IgnoreError | Out-Null
    }
    Write-Host "   added $($allIssueNumbers.Count) issues to the board." -ForegroundColor Green
  }
}
