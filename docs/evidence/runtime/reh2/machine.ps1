param([string]$Checkout = 'E:/Projects/ulpin-wt/demo')
# REH1's machine.ps1 for ulpin-reh-02: a checkout's API and dispatcher processes, free space and the listeners
# on the rehearsal's ports 21021-21026. Names, ids and times only.
$ErrorActionPreference = 'Stop'
$resolved = $Checkout.Replace('/', '\')
$entries = @('apps\api\src\main.ts', 'scripts\dispatcher.ts')
$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'"
$rows = @()
foreach ($entry in $entries) {
    $target = "$resolved\$entry"
    foreach ($process in $processes) {
        if ($process.CommandLine -and $process.CommandLine.Contains($target)) {
            $rows += [ordered]@{
                pid = $process.ProcessId
                started = $process.CreationDate.ToUniversalTime().ToString('o')
                entry = "$Checkout/$($entry.Replace('\', '/'))"
            }
        }
    }
}
[ordered]@{
    processes = $rows
    freeGB = [math]::Round((Get-PSDrive E).Free / 1GB, 3)
    listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -ge 21021 -and $_.LocalPort -le 21026 } |
        Select-Object LocalAddress, LocalPort, OwningProcess)
} | ConvertTo-Json -Depth 5 -Compress
