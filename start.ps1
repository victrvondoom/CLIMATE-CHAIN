<#
.SYNOPSIS
  Climate Chain Unified Launch Script
.DESCRIPTION
  Validates dependencies, loads canonical root .env configuration, starts local Hardhat EVM proof-chain,
  deploys smart contracts, builds frontend assets, and launches the mission-supervised production gateway.
#>

$ErrorActionPreference = 'Stop'

Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  CLIMATE CHAIN -- UNIFIED MULTI-TRACK CLIMATE PLATFORM" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Green

# 1. Locate Root and Subsystems
$rootDir = $PSScriptRoot
$climateChainDir = Join-Path $rootDir 'climate-chain'
$envFile = Join-Path $rootDir '.env'

if (-not (Test-Path $climateChainDir)) {
    throw "Climate Chain application directory not found at $climateChainDir"
}

# 2. Load Canonical Root Environment Configuration
if (Test-Path $envFile) {
    Write-Host "Loading configuration from canonical root .env..." -ForegroundColor DarkGray
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $parts = $line.Split('=', 2)
            $varName = $parts[0].Trim()
            $varValue = $parts[1].Trim()
            if (-not [string]::IsNullOrEmpty($varName)) {
                [System.Environment]::SetEnvironmentVariable($varName, $varValue, [System.EnvironmentVariableTarget]::Process)
            }
        }
    }
}

# 3. Verify Node.js Environment
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    throw "Node.js is required but was not found in PATH. Please install Node.js 22 LTS or newer."
}
$nodeVersion = (& node --version).Trim()
Write-Host "Runtime: Node.js $nodeVersion" -ForegroundColor Gray

# 4. Delegate to the Canonical Platform Launcher
$targetLauncher = Join-Path $climateChainDir 'start.ps1'
if (-not (Test-Path $targetLauncher)) {
    throw ('Canonical platform launcher missing at ' + $targetLauncher)
}

Push-Location $climateChainDir
try {
    & powershell.exe -ExecutionPolicy Bypass -File $targetLauncher
}
finally {
    Pop-Location
}
