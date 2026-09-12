param([string]$PackageDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$candidateRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $candidateRoot 'candidate.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFileName($manifest.file) -ne $manifest.file -or $manifest.file -notmatch '\.exe$') { throw 'Invalid candidate filename' }
$candidate = Join-Path $candidateRoot $manifest.file
$actualHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
$actualBytes = (Get-Item -LiteralPath $candidate).Length
$signature = Get-AuthenticodeSignature -LiteralPath $candidate
$environmentErrors = @()
$osInfo = $null
try { $osInfo = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture } catch { $environmentErrors += 'Operating system details could not be queried' }
$toolsFound = @()
foreach ($toolName in @('python.exe','python3.exe','node.exe')) {
    $found = Get-Command $toolName -CommandType Application -ErrorAction SilentlyContinue
    if ($found) { $toolsFound += $toolName }
}
$report = [ordered]@{
    schemaVersion = 1
    recordedAt = (Get-Date).ToUniversalTime().ToString('o')
    candidateFile = $manifest.file
    sha256 = $actualHash
    bytes = $actualBytes
    integrityMatches = ($actualHash -eq $manifest.sha256 -and $actualBytes -eq $manifest.bytes)
    signatureStatus = [string]$signature.Status
    expectedDevelopmentSignatureStatus = $manifest.signatureStatus
    os = $osInfo
    processArchitecture = $env:PROCESSOR_ARCHITECTURE
    commandsDiscoverable = $toolsFound
    environmentErrors = $environmentErrors
    cleanMachineStatus = 'Not assessed: PATH discovery alone does not prove a clean machine'
    installerExecuted = $false
    installationAcceptance = 'Not run'
    upgradeAcceptance = 'Not run'
    uninstallAcceptance = 'Not run'
    realDataAcceptance = 'Not run'
}
$reportName = 'preflight-' + [Guid]::NewGuid().ToString() + '.json'
$reportFile = Join-Path $candidateRoot $reportName
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportFile -Encoding UTF8
Write-Output $reportFile
if (-not $report.integrityMatches) { throw 'Candidate integrity mismatch. Do not run this installer.' }
Write-Output 'Integrity matches. This script did not run the installer or certify the machine as clean.'
