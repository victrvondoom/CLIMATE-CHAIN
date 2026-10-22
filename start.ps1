$ErrorActionPreference = 'Stop'

$frontendDir = Join-Path $PSScriptRoot 'frontend'
$gatewayDir = Join-Path $PSScriptRoot 'gateway'
$typescriptCmd = Join-Path $frontendDir 'node_modules\.bin\tsc.cmd'

if (-not (Test-Path -LiteralPath $typescriptCmd)) {
  throw "Frontend dependencies are missing. Run 'npm install' once from $frontendDir, then run this launcher again."
}

Push-Location $frontendDir
try {
  Write-Host 'Building the Climate Chain workspace...'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
}
finally {
  Pop-Location
}

Push-Location $gatewayDir
try {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $gatewayPort = if ($env:PORT) { $env:PORT } else { '8080' }
  Write-Host "Starting Climate Chain at http://127.0.0.1:$gatewayPort with a supervised mission worker. Press Ctrl+C to stop."
  & $nodePath mission-supervisor.mjs
  if ($LASTEXITCODE -ne 0) { throw "Climate Chain supervisor exited with code $LASTEXITCODE." }
}
finally {
  Pop-Location
}
