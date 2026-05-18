$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$startedProcess = $null

try {
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8080/status | Out-Null
    } catch {
        if (-not (Test-Path .\db.exe)) {
            & .\build.ps1
        }
        $startedProcess = Start-Process -FilePath .\db.exe -PassThru -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }

    $status = Invoke-RestMethod http://127.0.0.1:8080/status
    $items = Invoke-RestMethod http://127.0.0.1:8080/items
    $search = Invoke-RestMethod "http://127.0.0.1:8080/search?v=0.9,0.8,0.7,0.6,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1&k=3&metric=cosine&algo=hnsw"

    if ($status.demoCount -lt 20) {
        throw 'Expected at least 20 demo vectors in /status.'
    }
    if ($items.Count -lt 20) {
        throw 'Expected at least 20 items from /items.'
    }
    if ($search.results.Count -lt 1) {
        throw 'Expected at least one search result from /search.'
    }

    Write-Host 'Smoke test passed.'
    Write-Host ("Ollama available: {0}" -f $status.ollamaAvailable)
} finally {
    if ($startedProcess) {
        Stop-Process -Id $startedProcess.Id -Force
    }
}
