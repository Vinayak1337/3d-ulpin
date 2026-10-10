$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$run = Join-Path $env:LOCALAPPDATA 'Docker/run'
$secretRun = Join-Path $env:LOCALAPPDATA 'docker-secrets-engine'
$expected = @('dockerEthernetVfkit', 'dockerInference', 'sailor-ingest.sock', 'userAnalyticsOtlpHttp.sock')

function Assert-SocketDirectory($path, $names) {
    $entries = @(Get-ChildItem -Force -LiteralPath $path)
    if ((($entries.Name | Sort-Object) -join ',') -ne (($names | Sort-Object) -join ',')) {
        throw "Unexpected entries in inspected socket-only directory: $path"
    }
    foreach ($entry in $entries) {
        if ($entry.Length -ne 0 -or -not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Not an inspected zero-byte runtime reparse socket: $($entry.Name)"
        }
    }
}

Assert-SocketDirectory $run $expected
if (Test-Path -LiteralPath $secretRun) { Assert-SocketDirectory $secretRun @('engine.sock') }
$names = @('Docker Desktop', 'com.docker.backend', 'com.docker.build', 'docker')
Get-Process | Where-Object { $_.ProcessName -in $names } | Stop-Process -Force
wsl.exe --terminate docker-desktop
Assert-SocketDirectory $run $expected
$backup = "$run.saved-k3c-$stamp"
Move-Item -LiteralPath $run -Destination $backup
New-Item -ItemType Directory -Path $run | Out-Null
$backups = @($backup)
if (Test-Path -LiteralPath $secretRun) {
    Assert-SocketDirectory $secretRun @('engine.sock')
    $secretBackup = "$secretRun.saved-k3c-$stamp"
    Move-Item -LiteralPath $secretRun -Destination $secretBackup
    New-Item -ItemType Directory -Path $secretRun | Out-Null
    $backups += $secretBackup
}
@{ hypothesis = 'Preserve exact stale runtime socket directories; empty paths allow normal Desktop startup'
   documentedRecovery = 'docs/RUNTIME.md and scripts/platform/evidence/s03/result.json'
   preserved = $backups; dataStorageTouched = $false; securitySettingsChanged = $false
} | ConvertTo-Json -Compress
