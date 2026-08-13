$ErrorActionPreference = 'Stop'

$package = Join-Path $PSScriptRoot 'pet.zip'
$targetDir = Join-Path $env:LOCALAPPDATA 'ArknightsBasePet'
$legacyInstallDirs = @(
  (Join-Path $env:LOCALAPPDATA 'SilverAshGnosisPet'),
  (Join-Path $env:LOCALAPPDATA 'silverash-gnosis-desktop-pet')
)
$stagingDir = Join-Path $env:TEMP 'arknights-base-pet-install'
$launcher = 'ArknightsBasePet.exe'
$processNames = @('ArknightsBasePet', 'SilverAshGnosisPet')

if (-not (Test-Path -LiteralPath $package)) {
  throw 'pet.zip is missing. Keep it beside this installer script.'
}

$running = Get-Process -Name $processNames -ErrorAction SilentlyContinue
if ($running) {
  Write-Host 'Closing the previous desktop-pet process...'
  $running | Stop-Process -Force
  $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
Expand-Archive -LiteralPath $package -DestinationPath $stagingDir -Force

$unpacked = Get-ChildItem -LiteralPath $stagingDir -Directory | Select-Object -First 1
if ($null -eq $unpacked) {
  throw 'The portable archive did not contain an application folder.'
}

if (Test-Path -LiteralPath $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}
foreach ($legacyDir in $legacyInstallDirs) {
  if (Test-Path -LiteralPath $legacyDir) {
    Remove-Item -LiteralPath $legacyDir -Recurse -Force
  }
}
Move-Item -LiteralPath $unpacked.FullName -Destination $targetDir -Force
Remove-Item -LiteralPath $stagingDir -Recurse -Force

$exe = Join-Path $targetDir $launcher
if (-not (Test-Path -LiteralPath $exe)) {
  throw 'The packaged desktop pet executable was not found.'
}

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) '明日方舟基建桌宠.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '明日方舟基建桌宠.lnk')
)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = $targetDir
  $shortcut.Save()
}

Start-Process -FilePath $exe -WorkingDirectory $targetDir
