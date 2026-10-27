$ErrorActionPreference = 'Stop'
$launch = Get-Content 'E:/BhuAayam-data/task-data/reh10/resume-20261022/studio-launch.json' | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($launch.pid)"
if ($null -eq $process) {
    Write-Output 'The rehearsal Studio launcher is already stopped.'
    exit 0
}
$expected = '*pnpm studio:dev --host 127.0.0.1 --port 5188 --strictPort*'
if ($process.CommandLine -notlike $expected) {
    throw 'The Studio launcher PID no longer has the command this session started; nothing stopped.'
}
$children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $launch.pid }
if (@($children).Count -eq 0) {
    throw 'The launcher has no child; inspect its identity before stopping anything.'
}
taskkill.exe /PID $launch.pid /T /F
exit $LASTEXITCODE
