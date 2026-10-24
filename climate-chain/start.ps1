$ErrorActionPreference = 'Stop'

$frontendDir = Join-Path $PSScriptRoot 'frontend'
$gatewayDir = Join-Path $PSScriptRoot 'gateway'
$blockchainDir = Join-Path $PSScriptRoot 'blockchain'
$typescriptCmd = Join-Path $frontendDir 'node_modules\.bin\tsc.cmd'
$hardhatCli = Join-Path $blockchainDir 'node_modules\hardhat\internal\cli\cli.js'
$ethersModule = Join-Path $gatewayDir 'node_modules\ethers\package.json'

if (-not (Test-Path -LiteralPath $typescriptCmd)) {
  throw "Frontend dependencies are missing. Run 'npm install' once from $frontendDir, then run this launcher again."
}
if (-not (Test-Path -LiteralPath $hardhatCli)) {
  throw "The local proof-chain dependencies are missing. Run 'npm install' once from $blockchainDir, then run this launcher again."
}
if (-not (Test-Path -LiteralPath $ethersModule)) {
  throw "The gateway's blockchain client is missing. Run 'npm install' once from $gatewayDir, then run this launcher again."
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

$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeVersionText = (& $nodePath --version).Trim().TrimStart('v')
$nodeVersion = [Version]::Parse($nodeVersionText)
$supportsSystemCa = ($nodeVersion.Major -gt 24) -or
  ($nodeVersion.Major -eq 24 -and $nodeVersion.Minor -ge 6) -or
  ($nodeVersion.Major -eq 23 -and $nodeVersion.Minor -ge 8) -or
  ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 19)
if (-not $supportsSystemCa) {
  throw "Climate Chain's live API gateway needs Node.js with system CA support. Use Node 22.19+, 23.8+, or 24.6+; found v$nodeVersionText."
}
$chainRpcUrl = 'http://127.0.0.1:18545'
$deploymentPath = Join-Path $blockchainDir 'deployments\localhost.json'
$chainStdout = Join-Path $env:TEMP "climate-chain-hardhat-$PID.out.log"
$chainStderr = Join-Path $env:TEMP "climate-chain-hardhat-$PID.err.log"
$chainProcess = $null
$previousRpc = $env:CLIMATE_CHAIN_RPC_URL
$previousDeployment = $env:CLIMATE_CHAIN_DEPLOYMENT

try {
  $occupied = Get-NetTCPConnection -State Listen -LocalPort 18545 -ErrorAction SilentlyContinue
  if ($occupied) { throw 'Port 18545 is already in use. Stop the existing process before starting Climate Chain.' }

  $env:CLIMATE_CHAIN_RPC_URL = $chainRpcUrl
  $env:CLIMATE_CHAIN_DEPLOYMENT = $deploymentPath
  Write-Host 'Starting the local evidence blockchain on 127.0.0.1:18545...'
  $hardhatArguments = '"{0}" node --hostname 127.0.0.1 --port 18545' -f $hardhatCli
  $chainProcess = Start-Process -FilePath $nodePath -ArgumentList $hardhatArguments -WorkingDirectory $blockchainDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $chainStdout -RedirectStandardError $chainStderr

  $chainReady = $false
  $rpcRequest = @{ jsonrpc = '2.0'; id = 1; method = 'eth_chainId'; params = @() } | ConvertTo-Json -Compress
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($chainProcess.HasExited) {
      $details = if (Test-Path $chainStderr) { Get-Content $chainStderr -Raw } else { 'No chain log was written.' }
      throw "The local evidence blockchain exited during startup. $details"
    }
    try {
      $chainResponse = Invoke-RestMethod -Uri $chainRpcUrl -Method Post -ContentType 'application/json' -Body $rpcRequest -TimeoutSec 2
      if ($chainResponse.result -eq '0x7a69') { $chainReady = $true; break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $chainReady) { throw 'The local evidence blockchain did not become ready on port 18545.' }

  Push-Location $blockchainDir
  try {
    Write-Host 'Deploying the evidence anchor contract...'
    & npm run deploy:local
    if ($LASTEXITCODE -ne 0) { throw "Local contract deployment failed with exit code $LASTEXITCODE." }
  }
  finally {
    Pop-Location
  }

  Push-Location $gatewayDir
  try {
    $gatewayPort = if ($env:PORT) { $env:PORT } else { '8080' }
    Write-Host "Starting Climate Chain at http://127.0.0.1:$gatewayPort with the local proof chain and a supervised mission worker. Press Ctrl+C to stop."
    & $nodePath --use-system-ca mission-supervisor.mjs
    if ($LASTEXITCODE -ne 0) { throw "Climate Chain supervisor exited with code $LASTEXITCODE." }
  }
  finally {
    Pop-Location
  }
}
finally {
  if ($chainProcess -and -not $chainProcess.HasExited) {
    Stop-Process -Id $chainProcess.Id -ErrorAction SilentlyContinue
  }
  if ($null -eq $previousRpc) { Remove-Item Env:CLIMATE_CHAIN_RPC_URL -ErrorAction SilentlyContinue } else { $env:CLIMATE_CHAIN_RPC_URL = $previousRpc }
  if ($null -eq $previousDeployment) { Remove-Item Env:CLIMATE_CHAIN_DEPLOYMENT -ErrorAction SilentlyContinue } else { $env:CLIMATE_CHAIN_DEPLOYMENT = $previousDeployment }
}
