<#
  Registers the native messaging host for the current Windows user.
  Run once per machine (covers ALL Chrome profiles of this user).

  Usage:
    powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id>

  Find <id> at chrome://extensions (Developer mode) after loading the unpacked
  extension. Because every profile loads the extension from the same folder, the
  ID is identical in all of them, so one registration is enough.
#>
param(
  [Parameter(Mandatory = $true)][string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$HostDir = $PSScriptRoot
$HostName = "com.jobtools.shared"
$BatPath = Join-Path $HostDir "host.bat"
$ManifestPath = Join-Path $HostDir "$HostName.json"

if (-not (Test-Path $BatPath)) { throw "host.bat not found next to install.ps1" }

$manifest = [ordered]@{
  name            = $HostName
  description     = "Hide and Highlight shared state host"
  path            = $BatPath
  type            = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $ManifestPath -Encoding ASCII

$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name "(default)" -Value $ManifestPath

Write-Host "Native host registered." -ForegroundColor Green
Write-Host "  host name : $HostName"
Write-Host "  manifest  : $ManifestPath"
Write-Host "  runs      : $BatPath"
Write-Host "  extension : $ExtensionId"
Write-Host ("Shared file : " + (Join-Path $HostDir 'shared-state.json'))
Write-Host ""
Write-Host "Restart Chrome (all profiles) to pick this up."
