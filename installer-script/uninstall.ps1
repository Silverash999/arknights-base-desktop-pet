$ErrorActionPreference = 'Stop'

$targetDir = Join-Path $env:LOCALAPPDATA 'ArknightsBasePet'
$launcher = 'ArknightsBasePet.exe'
$uninstallCommand = 'Uninstall-ArknightsBasePet.cmd'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ArknightsBasePet'
$processNames = @('ArknightsBasePet', 'SilverAshGnosisPet')

$running = Get-Process -Name $processNames -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
}

$shell = New-Object -ComObject WScript.Shell
$expectedTargets = @(
  (Join-Path $targetDir $launcher),
  (Join-Path $targetDir $uninstallCommand)
)
foreach ($shortcutRoot in @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('Programs')
)) {
  Get-ChildItem -LiteralPath $shortcutRoot -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $shortcut = $shell.CreateShortcut($_.FullName)
      if ($expectedTargets | Where-Object { [string]::Equals($_, $shortcut.TargetPath, [System.StringComparison]::OrdinalIgnoreCase) }) {
        Remove-Item -LiteralPath $_.FullName -Force
      }
    } catch {
      # A broken or inaccessible third-party shortcut must not block uninstall.
    }
  }
}

if (Test-Path -LiteralPath $uninstallKey) {
  Remove-Item -LiteralPath $uninstallKey -Recurse -Force
}

if (Test-Path -LiteralPath $targetDir) {
  # This script runs from the install directory. Start a short-lived child so
  # the parent PowerShell can exit before that directory is removed.
  $cleanupCommand = "Start-Sleep -Seconds 2; Remove-Item -LiteralPath `"$targetDir`" -Recurse -Force"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cleanupCommand) -WindowStyle Hidden
}
