param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$DisabledShareSlug = ""
)

$ErrorActionPreference = "Stop"

function Pass([string]$Label) {
  Write-Host "[PASS] $Label"
}

function Fail([string]$Label) {
  throw "[FAIL] $Label"
}

function Get-StatusCode([string]$Path) {
  try {
    $response = Invoke-WebRequest -Uri ($BaseUrl + $Path) -Method Get -MaximumRedirection 0 -ErrorAction Stop
    return [int]$response.StatusCode
  }
  catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode) {
      return [int]$statusCode
    }
    throw
  }
}

function Assert-Status([string]$Label, [string]$Path, [int]$Expected) {
  $actual = Get-StatusCode $Path
  if ($actual -ne $Expected) {
    Fail(("${Label}: expected {0}, got {1} ({2})" -f $Expected, $actual, $Path))
  }
  Pass($Label)
}

Assert-Status "Unauthorized /api/notes" "/api/notes" 401
Assert-Status "Blocked /data path" "/data/secret.txt" 404
Assert-Status "Blocked sqlite path" "/app.sqlite" 404
Assert-Status "Blocked db path" "/backup.db" 404
Assert-Status "Blocked traversal path" "/notes/../../app.sqlite" 404
Assert-Status "Blocked traversal API path" "/api/notes/..%2F..%2Fsecret.txt" 404

if ($DisabledShareSlug) {
  Assert-Status "Disabled public share" "/s/$DisabledShareSlug" 404
}
else {
  Write-Host "[SKIP] Disabled public share (pass -DisabledShareSlug to test)"
}

Write-Host ""
Write-Host "Security checks completed successfully for $BaseUrl"
