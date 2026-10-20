# Docker Desktop guard: clears the stale sockets that stop Docker Desktop's backend at start after a crash or an
# unclean shutdown ("rename ...sock ...sock.stale: The file cannot be accessed by the system").
# It stops only Docker's own processes, renames two socket folders aside together and starts Docker Desktop once.
# It never deletes anything, never touches volumes, WSL or Docker's own configuration, and the aside copies stay.
# Output names folders relative to the root and never prints environment values, command lines or credentials.
# Usage and the never list: docs/backend/DOCKER-GUARD.md
param(
  [switch]$Check,
  [switch]$Recover,
  [switch]$Prestart,
  [switch]$Watch,
  [string]$Root = $env:LOCALAPPDATA,
  [string]$DockerExe = 'docker',
  [string]$DesktopExe = (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
  [string]$OpsDir = 'E:\BhuAayam-data\ops\docker-guard',
  [switch]$DryRun,
  [int]$RecheckSeconds = 5,
  [int]$WaitSeconds = 180,
  [string]$Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss')
)
$ErrorActionPreference = 'Stop'

$DemoPrefix = 'ulpin-demo-'
$StartingSeconds = 120
$WatchFailuresToRecover = 2
$RecoverLimit = 3
$RecoverLimitHours = 6
$RunDir = Join-Path $Root 'Docker\run'
$SecretsDir = Join-Path $Root 'docker-secrets-engine'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-FullPath([string]$Path) { [IO.Path]::GetFullPath($Path).TrimEnd('\') }

$RootIsDefault = (Get-FullPath $Root) -eq (Get-FullPath $env:LOCALAPPDATA)
# A dry run never stops or starts a process; it renames folders only under a -Root other than the real one.
$RenameForReal = -not ($DryRun -and $RootIsDefault)

function Hide-Root([string]$Text) {
  if (-not $Text) { return $Text }
  foreach ($base in @((Get-FullPath $Root), (Get-FullPath $env:LOCALAPPDATA))) {
    $Text = $Text.Replace($base, '{root}').Replace($base.Replace('\', '/'), '{root}')
  }
  $Text
}

function Get-RelativeName([string]$Path) { Hide-Root (Get-FullPath $Path) }

function Invoke-Docker([string]$Arguments) {
  $command = Get-Command $DockerExe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) { return @{ code = -1; out = '' } }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $command.Source
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $process = [System.Diagnostics.Process]::Start($info)
  $out = $process.StandardOutput.ReadToEndAsync()
  $null = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(20000)) {
    try { $process.Kill() } catch { }
    return @{ code = -2; out = '' }
  }
  $process.WaitForExit()
  @{ code = $process.ExitCode; out = $out.Result }
}

function Test-Engine {
  $result = Invoke-Docker 'version --format "{{.Server.Version}}"'
  $server = "$($result.out)".Trim()
  [ordered]@{ answers = ($result.code -eq 0 -and $server -ne ''); exitCode = $result.code }
}

function Test-DockerName([string]$Name) {
  $Name -eq 'Docker Desktop' -or $Name -like 'com.docker.*' -or $Name -eq 'docker'
}

function Get-DockerProcesses {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { Test-DockerName $_.ProcessName } | ForEach-Object {
    $age = $null
    try { $age = [int]((Get-Date) - $_.StartTime).TotalSeconds } catch { }
    [ordered]@{ name = $_.ProcessName; id = $_.Id; ageSeconds = $age }
  })
}

function Get-SocketEntries([string]$Dir) {
  $entries = [ordered]@{ folder = (Get-RelativeName $Dir); present = $false; count = 0; names = @() }
  if (-not [IO.Directory]::Exists($Dir)) { return $entries }
  $names = @()
  foreach ($path in [IO.Directory]::EnumerateFileSystemEntries($Dir)) {
    $name = [IO.Path]::GetFileName($path)
    $reparse = $true
    try { $reparse = ([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -ne 0 } catch { }
    if ($reparse -or $name -like '*.sock') { $names += $name }
  }
  $entries.present = $true
  $entries.count = $names.Count
  $entries.names = $names
  $entries
}

function Get-Sockets { , @((Get-SocketEntries $RunDir), (Get-SocketEntries $SecretsDir)) }

function Get-StaleLogLines {
  $logDir = Join-Path $Root 'Docker\log\host'
  $newest = Get-ChildItem -LiteralPath $logDir -Filter 'com.docker.backend*' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { return [ordered]@{ file = $null; lines = @() } }
  $lines = @()
  try {
    $lines = @(Select-String -LiteralPath $newest.FullName -Pattern '\.sock\.stale|cannot be accessed' |
      Select-Object -Last 20 | ForEach-Object {
        $line = Hide-Root $_.Line
        $line.Substring(0, [Math]::Min(400, $line.Length))
      })
  } catch { $lines = @("log not readable: $(Hide-Root $_.Exception.Message)") }
  [ordered]@{ file = $newest.Name; lines = $lines }
}

function Get-Health([string]$Status) {
  if ($Status -match '\((healthy|unhealthy|health: starting)\)') { return $Matches[1].Replace('health: ', '') }
  $null
}

function Get-DemoContainers {
  $result = Invoke-Docker "ps -a --filter name=$DemoPrefix --format `"{{json .}}`""
  if ($result.code -ne 0) { return $null }
  , @("$($result.out)" -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object { $_.Names -like "$DemoPrefix*" } |
    ForEach-Object { [ordered]@{ name = $_.Names; state = $_.State; health = (Get-Health $_.Status) } })
}

function Get-RunningDemoNames {
  $containers = Get-DemoContainers
  if ($null -eq $containers) { return $null }
  , @($containers | Where-Object { $_.state -eq 'running' } | ForEach-Object { $_.name })
}

function Read-State {
  $path = Join-Path $OpsDir 'state.json'
  $state = [ordered]@{ failures = 0; lastRunning = @(); lastRunningAt = $null; recoveries = @() }
  if (Test-Path -LiteralPath $path) {
    try { $saved = [IO.File]::ReadAllText($path) | ConvertFrom-Json } catch { $saved = $null }
    foreach ($key in @($state.Keys)) { if ($null -ne $saved.$key) { $state[$key] = $saved.$key } }
  }
  $state.lastRunning = @($state.lastRunning)
  $state.recoveries = @($state.recoveries)
  $state
}

function Write-State($State) {
  [IO.File]::WriteAllText((Join-Path $OpsDir 'state.json'), ($State | ConvertTo-Json -Depth 4), $Utf8)
}

function Write-RunLine($Run) {
  $file = Join-Path $OpsDir ((Get-Date -Format 'yyyy-MM-dd') + '.jsonl')
  [IO.File]::AppendAllText($file, ($Run | ConvertTo-Json -Depth 8 -Compress) + "`n", $Utf8)
}

function Stop-DockerProcesses {
  $found = @(Get-DockerProcesses)
  $result = [ordered]@{ found = $found; stopped = @(); failed = @(); remaining = @() }
  if ($DryRun) { $result.planned = $true; return $result }
  foreach ($entry in $found) {
    try {
      Stop-Process -Id $entry.id -Force -ErrorAction Stop
      $result.stopped += $entry.id
    } catch {
      if (Get-Process -Id $entry.id -ErrorAction SilentlyContinue) {
        $result.failed += [ordered]@{ name = $entry.name; id = $entry.id; error = $_.Exception.Message }
      }
    }
  }
  $until = (Get-Date).AddSeconds(30)
  while (@(Get-DockerProcesses).Count -gt 0 -and (Get-Date) -lt $until) { Start-Sleep -Seconds 1 }
  $result.remaining = @(Get-DockerProcesses)
  $result
}

# Both folders move aside in one step: Docker Desktop fails again when only one of them is moved.
function Move-SocketFoldersAside {
  $pairs = @(
    @{ from = $RunDir; to = (Join-Path $Root "Docker\run.stale-guard-$Stamp") },
    @{ from = $SecretsDir; to = (Join-Path $Root "docker-secrets-engine.stale-guard-$Stamp") }
  )
  $result = [ordered]@{ ok = $true; forReal = $RenameForReal; moved = @(); absent = @(); error = $null }
  $result.putBack = $null
  $done = @()
  foreach ($pair in $pairs) {
    $move = [ordered]@{ from = (Get-RelativeName $pair.from); to = (Get-RelativeName $pair.to) }
    if (-not [IO.Directory]::Exists($pair.from)) { $result.absent += $move.from; continue }
    if (-not $RenameForReal) { $result.moved += $move; continue }
    try {
      [IO.Directory]::Move($pair.from, $pair.to)
      $done += $pair
      $result.moved += $move
    } catch {
      $result.ok = $false
      $result.error = "could not rename $($move.from) to $($move.to): $(Hide-Root $_.Exception.Message)"
      $result.putBack = $true
      foreach ($back in $done) {
        try { [IO.Directory]::Move($back.to, $back.from) } catch {
          $result.putBack = $false
          $result.error += "; could not put $(Get-RelativeName $back.to) back: $(Hide-Root $_.Exception.Message)"
        }
      }
      if ($result.putBack) { $result.moved = @() }
      break
    }
  }
  $result
}

function Start-Desktop {
  if ($DryRun) { return 'planned' }
  if (-not (Test-Path -LiteralPath $DesktopExe)) { return 'desktop_exe_missing' }
  Start-Process -FilePath $DesktopExe
  'started'
}

function Wait-Engine {
  $started = Get-Date
  $until = $started.AddSeconds($WaitSeconds)
  do {
    if ((Test-Engine).answers) { return [int]((Get-Date) - $started).TotalSeconds }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $until)
  $null
}

function Wait-Containers($Names) {
  $until = (Get-Date).AddSeconds($WaitSeconds)
  do {
    $running = Get-RunningDemoNames
    $missing = @($Names | Where-Object { $null -eq $running -or $running -notcontains $_ })
    if ($missing.Count -eq 0) { break }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $until)
  [ordered]@{ expected = @($Names); missing = $missing }
}

function Set-Outcome($Run, [string]$Outcome, [int]$ExitCode) {
  $Run.outcome = $Outcome
  $Run.exitCode = $ExitCode
  $Run
}

function Complete-Rename($Run) {
  $rename = $Run.rename
  if ($rename.ok) { return $null }
  if ($rename.putBack) { return Set-Outcome $Run 'rename_failed_put_back' 4 }
  Set-Outcome $Run 'rename_failed_not_put_back' 5
}

function Invoke-Recovery($State) {
  $run = [ordered]@{ engineChecks = @() }
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    if ($attempt -gt 0) { Start-Sleep -Seconds $RecheckSeconds }
    $engine = Test-Engine
    $run.engineChecks += $engine.exitCode
    if ($engine.answers) { return Set-Outcome $run 'engine_answers' 0 }
  }
  $run.expectedContainers = @($State.lastRunning)
  $run.stop = Stop-DockerProcesses
  $run.rename = Move-SocketFoldersAside
  if (Complete-Rename $run) { return $run }
  $run.start = Start-Desktop
  if ($DryRun) { return Set-Outcome $run 'dry_run' 0 }
  $run.engineSeconds = Wait-Engine
  if ($null -eq $run.engineSeconds) { return Set-Outcome $run 'engine_not_back' 3 }
  $run.containers = Wait-Containers $run.expectedContainers
  if ($run.containers.missing.Count -gt 0) { return Set-Outcome $run 'containers_not_back' 6 }
  Set-Outcome $run 'recovered' 0
}

function Invoke-Prestart {
  $run = [ordered]@{ processes = @(Get-DockerProcesses); sockets = (Get-Sockets) }
  $socketCount = ($run.sockets | Measure-Object -Property count -Sum).Sum
  if ($run.processes.Count -eq 0 -and $socketCount -gt 0) {
    $run.rename = Move-SocketFoldersAside
    if (Complete-Rename $run) { return $run }
  }
  if ((Test-Engine).answers) { return Set-Outcome $run 'engine_answers' 0 }
  if (-not ($run.processes | Where-Object { $_.name -eq 'Docker Desktop' })) { $run.start = Start-Desktop }
  if ($DryRun) { return Set-Outcome $run 'dry_run' 0 }
  $run.engineSeconds = Wait-Engine
  if ($null -eq $run.engineSeconds) { return Set-Outcome $run 'engine_not_back' 3 }
  Set-Outcome $run 'engine_back' 0
}

function Invoke-Watch($State) {
  $run = [ordered]@{}
  if ((Test-Engine).answers) {
    $State.failures = 0
    $running = Get-RunningDemoNames
    if ($null -ne $running) { $State.lastRunning = $running; $State.lastRunningAt = (Get-Date).ToString('o') }
    return Set-Outcome $run 'engine_answers' 0
  }
  $starting = @(Get-DockerProcesses | Where-Object {
    $_.name -eq 'Docker Desktop' -and $null -ne $_.ageSeconds -and $_.ageSeconds -lt $StartingSeconds })
  if ($starting.Count -gt 0) { return Set-Outcome $run 'desktop_starting' 0 }
  $State.failures = [int]$State.failures + 1
  $run.failures = $State.failures
  if ($State.failures -lt $WatchFailuresToRecover) { return Set-Outcome $run 'engine_silent_waiting' 3 }
  $since = (Get-Date).AddHours(-$RecoverLimitHours)
  $recent = @($State.recoveries | Where-Object { [DateTime]::Parse($_) -gt $since })
  if ($recent.Count -ge $RecoverLimit) { return Set-Outcome $run 'recover_limit_reached' 3 }
  $run.recover = Invoke-Recovery $State
  $State.failures = 0
  if ($run.recover.outcome -ne 'engine_answers') { $State.recoveries = @($recent) + (Get-Date).ToString('o') }
  Set-Outcome $run $run.recover.outcome $run.recover.exitCode
}

function Write-Json($Value) { Write-Output ($Value | ConvertTo-Json -Depth 8 -Compress) }

$modes = @('Check', 'Recover', 'Prestart', 'Watch' | Where-Object { (Get-Variable $_ -ValueOnly).IsPresent })
if ($modes.Count -ne 1) {
  Write-Json ([ordered]@{ ok = $false; error = 'give exactly one of -Check, -Recover, -Prestart, -Watch' })
  exit 2
}
$mode = $modes[0]

if ($mode -eq 'Check') {
  $engine = Test-Engine
  $report = [ordered]@{
    mode = 'check'; at = (Get-Date).ToString('o'); rootIsDefault = $RootIsDefault; engine = $engine
    processes = @(Get-DockerProcesses)
    sockets = (Get-Sockets)
    socketsNote = 'socket entries are stale only while no Docker process runs'
    backendLog = (Get-StaleLogLines)
    demoContainers = $null
  }
  if ($engine.answers) { $report.demoContainers = Get-DemoContainers }
  Write-Json $report
  if ($engine.answers) { exit 0 } else { exit 3 }
}

if (-not $RootIsDefault -and -not $DryRun) {
  $refusal = 'a -Root other than the real one needs -DryRun'
  Write-Json ([ordered]@{ mode = $mode.ToLower(); ok = $false; error = $refusal })
  exit 2
}
[void][IO.Directory]::CreateDirectory($OpsDir)
$paused = Test-Path -LiteralPath (Join-Path $OpsDir 'paused')
if ($paused -and $mode -ne 'Recover') {
  Write-Json ([ordered]@{ mode = $mode.ToLower(); paused = $true; outcome = 'paused'; exitCode = 0 })
  exit 0
}
try {
  $lock = [IO.File]::Open((Join-Path $OpsDir 'guard.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
  Write-Json ([ordered]@{ mode = $mode.ToLower(); outcome = 'another_guard_run_is_active'; exitCode = 0 })
  exit 0
}
try {
  $state = Read-State
  $result = switch ($mode) {
    'Recover' { Invoke-Recovery $state }
    'Prestart' { Invoke-Prestart }
    'Watch' { Invoke-Watch $state }
  }
  $line = [ordered]@{ mode = $mode.ToLower(); at = (Get-Date).ToString('o'); dryRun = [bool]$DryRun }
  foreach ($key in $result.Keys) { $line[$key] = $result[$key] }
  Write-State $state
  Write-RunLine $line
  Write-Json $line
  exit $line.exitCode
} finally {
  $lock.Dispose()
}
