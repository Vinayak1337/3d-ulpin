# Installs, removes or reports the two per-user Scheduled Tasks that run docker-guard.ps1 (no administrator rights,
# no system setting). -Status also reads Docker Desktop's own AutoStart value, that key only, without changing it.
# Usage: docs/backend/DOCKER-GUARD.md
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [string]$GuardScript = 'E:\Projects\3d-ulpin\scripts\platform\docker-guard.ps1'
)
$ErrorActionPreference = 'Stop'

$LogonTask = 'ULPIN Docker guard logon'
$WatchTask = 'ULPIN Docker guard watch'
$User = "$env:USERDOMAIN\$env:USERNAME"

function New-GuardAction([string]$Mode) {
  $arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$GuardScript`" -$Mode"
  New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
}

function Register-GuardTask([string]$Name, [string]$Mode, $Trigger) {
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
  $null = Register-ScheduledTask -TaskName $Name -Action (New-GuardAction $Mode) -Trigger $Trigger `
    -Principal $principal -Settings $settings -Description "Runs docker-guard.ps1 -$Mode" -Force
}

function Get-DockerAutoStart {
  foreach ($name in @('settings-store.json', 'settings.json')) {
    $path = Join-Path $env:APPDATA "Docker\$name"
    if (Test-Path -LiteralPath $path) {
      $value = ([IO.File]::ReadAllText($path) | ConvertFrom-Json).AutoStart
      return [ordered]@{ file = $name; autoStart = $value }
    }
  }
  [ordered]@{ file = $null; autoStart = $null }
}

function Get-GuardTask([string]$Name) {
  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $task) { return [ordered]@{ name = $Name; installed = $false } }
  $info = Get-ScheduledTaskInfo -TaskName $Name
  [ordered]@{
    name = $Name; installed = $true; state = "$($task.State)"; action = $task.Actions[0].Arguments
    lastRun = $info.LastRunTime; lastResult = $info.LastTaskResult; nextRun = $info.NextRunTime
  }
}

$modes = @('Install', 'Uninstall', 'Status' | Where-Object { (Get-Variable $_ -ValueOnly).IsPresent })
if ($modes.Count -ne 1) { Write-Output 'give exactly one of -Install, -Uninstall, -Status'; exit 2 }

if ($Install) {
  if (-not (Test-Path -LiteralPath $GuardScript)) { Write-Output "guard script not found: $GuardScript"; exit 2 }
  Register-GuardTask $LogonTask 'Prestart' (New-ScheduledTaskTrigger -AtLogOn -User $User)
  $every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  Register-GuardTask $WatchTask 'Watch' $every
  Write-Output "installed: $LogonTask (-Prestart at logon), $WatchTask (-Watch every 5 minutes)"
  exit 0
}

if ($Uninstall) {
  foreach ($name in @($LogonTask, $WatchTask)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Output "removed task: $name"
    } else { Write-Output "not installed: $name" }
  }
  exit 0
}

$autoStart = Get-DockerAutoStart
$note = 'The logon task starts Docker Desktop itself after clearing stale sockets.'
if ($autoStart.autoStart -eq $true) {
  $note += ' Docker Desktop AutoStart is on, so Docker may start before the logon task can clear stale sockets;' +
    ' turning it off in Docker Desktop (Settings, General) is the owner''s choice.'
}
$tasks = @((Get-GuardTask $LogonTask), (Get-GuardTask $WatchTask))
$report = [ordered]@{ tasks = $tasks; docker = $autoStart; note = $note }
Write-Output ($report | ConvertTo-Json -Depth 4)
