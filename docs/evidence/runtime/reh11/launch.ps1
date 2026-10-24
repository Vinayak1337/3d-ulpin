$ErrorActionPreference = 'Stop'
$root = 'E:/Projects/ulpin-wt/ulpin-reh-02'
$scratch = 'E:/BhuAayam-data/task-data/reh11'
$env:ULPIN_API_TARGET = 'http://127.0.0.1:21026'
$studio = Start-Process cmd.exe -ArgumentList '/d /s /c pnpm studio:dev --host 127.0.0.1 --port 5188 --strictPort' `
    -WorkingDirectory $root -RedirectStandardOutput "$scratch/studio.out" `
    -RedirectStandardError "$scratch/studio.err" -PassThru
$presenter = Start-Process node.exe -ArgumentList 'docs/evidence/runtime/reh11/dress.mjs' `
    -WorkingDirectory 'E:/Projects/ulpin-wt/k3' -RedirectStandardOutput "$scratch/dress.out" `
    -RedirectStandardError "$scratch/dress.err" -PassThru
@{ studioPid = $studio.Id; presenterPid = $presenter.Id; at = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json -Compress | Set-Content "$scratch/launch.json"
Write-Output "Studio launcher $($studio.Id); presenter $($presenter.Id)"
