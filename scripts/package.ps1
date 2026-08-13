$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronDist = Join-Path $projectRoot 'node_modules\electron\dist'
$releaseDirectory = if ([string]::IsNullOrWhiteSpace($env:PET_RELEASE_DIR)) { 'release' } else { $env:PET_RELEASE_DIR }
$releaseRoot = Join-Path $projectRoot $releaseDirectory
$appName = ([char]0x660E).ToString() + ([char]0x65E5).ToString() + ([char]0x65B9).ToString() + ([char]0x821F).ToString() + ([char]0x57FA).ToString() + ([char]0x5EFA).ToString() + ([char]0x684C).ToString() + ([char]0x5BA0).ToString()
$installGuideName = ([char]0x5B89).ToString() + ([char]0x88C5).ToString() + ([char]0x8BF4).ToString() + ([char]0x660E).ToString() + '.md'
$completeInstallerName = ([char]0x5B8C).ToString() + ([char]0x6574).ToString() + ([char]0x5B89).ToString() + ([char]0x88C5).ToString() + ([char]0x5305).ToString()
$launcherExe = 'ArknightsBasePet.exe'
$portableDir = Join-Path $releaseRoot "$appName-portable"
$bundleMaterials = $env:PET_BUNDLE_MATERIALS -eq '1'
$skipArchives = $env:PET_SKIP_ARCHIVES -eq '1'
$portableOnly = $env:PET_PORTABLE_ONLY -eq '1'

if (-not (Test-Path -LiteralPath (Join-Path $electronDist 'electron.exe'))) {
  throw 'Electron runtime was not found. Run npm install first.'
}

if (Test-Path -LiteralPath $releaseRoot) {
  $resolvedRelease = (Resolve-Path -LiteralPath $releaseRoot).Path
  $resolvedProject = (Resolve-Path -LiteralPath $projectRoot).Path
  if (-not $resolvedRelease.StartsWith($resolvedProject, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a path outside this workspace: $resolvedRelease"
  }
  Remove-Item -LiteralPath $resolvedRelease -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
Get-ChildItem -LiteralPath $electronDist -Force | Copy-Item -Destination $portableDir -Recurse -Force
Move-Item -LiteralPath (Join-Path $portableDir 'electron.exe') -Destination (Join-Path $portableDir $launcherExe) -Force

$appResourceDir = Join-Path $portableDir 'resources\app'
New-Item -ItemType Directory -Force -Path $appResourceDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $appResourceDir -Recurse -Force
if ($bundleMaterials) {
  Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') -Destination $appResourceDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'prts-assets') -Destination $appResourceDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'processed-assets') -Destination $appResourceDir -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appResourceDir -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $portableDir -Force
Copy-Item -LiteralPath (Join-Path $projectRoot $installGuideName) -Destination $portableDir -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'PORTABLE_README.md') -Destination $portableDir -Force

if ($skipArchives) {
  Write-Host "Portable folder: $portableDir"
  Write-Host "Bundled character materials: $bundleMaterials"
  Write-Host 'Archives and installer wrapper: skipped (PET_SKIP_ARCHIVES=1).'
  exit 0
}

$zipPath = Join-Path $releaseRoot "$appName-portable.zip"
Compress-Archive -LiteralPath $portableDir -DestinationPath $zipPath -CompressionLevel Optimal

if ($portableOnly) {
  Write-Host "Portable folder: $portableDir"
  Write-Host "Portable archive: $zipPath"
  Write-Host "Bundled character materials: $bundleMaterials"
  Write-Host 'Installer wrapper: skipped (PET_PORTABLE_ONLY=1).'
  exit 0
}

$installerOutput = Join-Path $releaseRoot 'script-installer'
New-Item -ItemType Directory -Force -Path $installerOutput | Out-Null
Copy-Item -LiteralPath $zipPath -Destination (Join-Path $installerOutput 'pet.zip') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer-script\Install-ArknightsBasePet.cmd') -Destination $installerOutput -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer-script\install.ps1') -Destination $installerOutput -Force
Copy-Item -LiteralPath (Join-Path $projectRoot $installGuideName) -Destination $installerOutput -Force

$completeInstallerDir = Join-Path $releaseRoot $completeInstallerName
New-Item -ItemType Directory -Force -Path $completeInstallerDir | Out-Null
Copy-Item -LiteralPath (Join-Path $installerOutput 'pet.zip') -Destination $completeInstallerDir -Force
Copy-Item -LiteralPath (Join-Path $installerOutput 'Install-ArknightsBasePet.cmd') -Destination $completeInstallerDir -Force
Copy-Item -LiteralPath (Join-Path $installerOutput 'install.ps1') -Destination $completeInstallerDir -Force
Copy-Item -LiteralPath (Join-Path $installerOutput $installGuideName) -Destination $completeInstallerDir -Force

$completeZipPath = Join-Path $releaseRoot "$completeInstallerName.zip"
Compress-Archive -LiteralPath $completeInstallerDir -DestinationPath $completeZipPath -CompressionLevel Optimal

Write-Host "Portable folder: $portableDir"
Write-Host "Portable archive: $zipPath"
Write-Host "Installer folder: $installerOutput"
Write-Host "Complete installer folder: $completeInstallerDir"
Write-Host "Complete installer archive: $completeZipPath"
Write-Host "Bundled character materials: $bundleMaterials"
