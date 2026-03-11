param(
    [switch]$InstallApk,
    [string]$DeviceId = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDir = Join-Path $root "dist"
$latestDir = Join-Path $distDir "latest"

Push-Location $root
try {
    Write-Step "Building Windows installer (.exe)"
    npm run electron:build
    if ($LASTEXITCODE -ne 0) { throw "electron:build failed." }

    $stamp = Get-Date -Format "yyMMddHH"
    $env:ANDROID_VERSION_CODE = $stamp
    $env:ANDROID_VERSION_NAME = "1.0.13-mobile+$stamp"

    Write-Step "Syncing Capacitor Android project"
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }

    Write-Step "Building Android release APK"
    Push-Location (Join-Path $root "android")
    try {
        .\gradlew.bat assembleRelease
        if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease failed." }
    } finally {
        Pop-Location
    }

    $exeFile = Get-ChildItem -Path $distDir -Filter "NewSecurityy-Setup-*.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $exeFile) { throw "No EXE artifact found in dist." }

    $apkFile = Join-Path $root "android\app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path $apkFile)) { throw "No APK artifact found at $apkFile" }

    New-Item -ItemType Directory -Path $latestDir -Force | Out-Null
    $latestExe = Join-Path $latestDir "NewSecurityy-Setup-latest.exe"
    $latestApk = Join-Path $latestDir "NewSecurityy-Mobile-latest.apk"

    Copy-Item -Path $exeFile.FullName -Destination $latestExe -Force
    Copy-Item -Path $apkFile -Destination $latestApk -Force

    Write-Step "Artifacts ready"
    Write-Host "EXE        : $($exeFile.FullName)"
    Write-Host "APK        : $apkFile"
    Write-Host "Latest EXE : $latestExe"
    Write-Host "Latest APK : $latestApk"

    if ($InstallApk) {
        Write-Step "Installing APK to device with adb install -r"
        $adbArgs = @("install", "-r", $latestApk)
        if ($DeviceId) {
            $adbArgs = @("-s", $DeviceId) + $adbArgs
        }
        & adb @adbArgs
        if ($LASTEXITCODE -ne 0) { throw "adb install failed." }
        Write-Host "APK install completed."
    }
} finally {
    Remove-Item Env:ANDROID_VERSION_CODE -ErrorAction SilentlyContinue
    Remove-Item Env:ANDROID_VERSION_NAME -ErrorAction SilentlyContinue
    Pop-Location
}
