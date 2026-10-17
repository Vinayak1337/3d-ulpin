# Process liveness only. Never print command lines, environment or credentials.
param([Parameter(Mandatory = $true)][string]$DispatcherEntry)
$ErrorActionPreference = 'Stop'
$expected = $DispatcherEntry.Replace('\', '/').ToLowerInvariant()
$matches = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Replace('\', '/').ToLowerInvariant().Contains($expected)
})
if ($matches.Count -eq 1) { Write-Output 'present' } else { Write-Output 'absent-or-ambiguous' }
