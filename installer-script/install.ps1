$ErrorActionPreference = 'Stop'

$package = Join-Path $PSScriptRoot 'pet.zip'
$targetDir = Join-Path $env:LOCALAPPDATA 'ArknightsBasePet'
$legacyInstallDirs = @(
  (Join-Path $env:LOCALAPPDATA 'SilverAshGnosisPet'),
  (Join-Path $env:LOCALAPPDATA 'silverash-gnosis-desktop-pet')
)
$stagingDir = Join-Path $env:TEMP 'arknights-base-pet-install'
$launcher = 'ArknightsBasePet.exe'
$uninstallCommand = 'Uninstall-ArknightsBasePet.cmd'
$uninstallScript = 'uninstall.ps1'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ArknightsBasePet'
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

foreach ($file in @($uninstallCommand, $uninstallScript)) {
  $source = Join-Path $PSScriptRoot $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Installer support file is missing: $file"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $targetDir $file) -Force
}

$installedPackage = Get-Content -LiteralPath (Join-Path $targetDir 'resources\app\package.json') -Raw | ConvertFrom-Json
$installedVersion = [string]$installedPackage.version
$installedUninstallCommand = Join-Path $targetDir $uninstallCommand
$commandProcessor = Join-Path $env:SystemRoot 'System32\cmd.exe'
$uninstallString = '"{0}" /d /c ""{1}""' -f $commandProcessor, $installedUninstallCommand
New-Item -Path $uninstallKey -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value '明日方舟基建桌宠' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value $installedVersion -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'DisplayIcon' -Value $exe -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'Publisher' -Value 'Silverash999' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value $uninstallString -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null

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

$uninstallShortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) '卸载明日方舟基建桌宠.lnk'))
$uninstallShortcut.TargetPath = $installedUninstallCommand
$uninstallShortcut.WorkingDirectory = $targetDir
$uninstallShortcut.Save()

Start-Process -FilePath $exe -WorkingDirectory $targetDir
