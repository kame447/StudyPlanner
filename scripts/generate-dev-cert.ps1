param(
  [string[]]$Hosts = @()
)

$mkcertCommand = Get-Command mkcert -ErrorAction SilentlyContinue

if (-not $mkcertCommand) {
  throw "mkcert が見つかりません。先に mkcert をインストールしてください。"
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$certDirectory = Join-Path $projectRoot '.cert'
$certFile = Join-Path $certDirectory 'study-planner-local.pem'
$keyFile = Join-Path $certDirectory 'study-planner-local-key.pem'

$defaultHosts = @(
  'localhost',
  '127.0.0.1',
  $env:COMPUTERNAME,
  "$($env:COMPUTERNAME).local"
)

$normalizedHosts = @(
  $defaultHosts + $Hosts |
    Where-Object { $_ -and $_.Trim() } |
    ForEach-Object { $_.Trim() } |
    Select-Object -Unique
)

New-Item -ItemType Directory -Path $certDirectory -Force | Out-Null

& $mkcertCommand.Source -install
& $mkcertCommand.Source -cert-file $certFile -key-file $keyFile @normalizedHosts

Write-Host "証明書を生成しました:"
Write-Host "  Cert: $certFile"
Write-Host "  Key : $keyFile"
Write-Host "ホスト名:"
$normalizedHosts | ForEach-Object { Write-Host "  - $_" }
