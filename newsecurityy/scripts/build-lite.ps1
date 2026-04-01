param()

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $root
try {
    $env:REACT_APP_FORCE_LITE = "true"
    $env:GENERATE_SOURCEMAP = "false"

    Write-Step "Building lite renderer bundle"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

    Write-Step "Packaging lite Windows installer"
    & ".\node_modules\.bin\electron-builder.cmd" --config electron-builder.lite.yml
    if ($LASTEXITCODE -ne 0) { throw "electron-builder lite build failed." }
} finally {
    Remove-Item Env:REACT_APP_FORCE_LITE -ErrorAction SilentlyContinue
    Remove-Item Env:GENERATE_SOURCEMAP -ErrorAction SilentlyContinue
    Pop-Location
}
