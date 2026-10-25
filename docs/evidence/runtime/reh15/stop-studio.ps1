$ErrorActionPreference = 'Stop'
$launch = Get-Content 'E:/BhuAayam-data/task-data/reh15/launch.json' | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($launch.studioPid)"
if ($null -eq $process) {
    Write-Output 'The rehearsal Studio launcher is already stopped.'
    exit 0
}
$expected = '*pnpm studio:dev --host 127.0.0.1 --port 5188 --strictPort*'
if ($process.CommandLine -notlike $expected) {
    throw 'The Studio launcher PID no longer has this session command; nothing stopped.'
}
taskkill.exe /PID $launch.studioPid /T /F
exit $LASTEXITCODE
