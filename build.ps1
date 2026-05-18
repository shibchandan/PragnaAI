$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

& g++ -std=c++17 -O2 main.cpp -o db -lws2_32
if ($LASTEXITCODE -ne 0) {
    throw 'Build failed.'
}

Write-Host 'Built db.exe'
