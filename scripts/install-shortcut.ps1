# Creates (or updates) the "Prompt Studio" desktop shortcut for the installed app.
# It does not touch any other shortcut, startup entry or system setting.
$ErrorActionPreference = 'Stop'
# Same resolution as scripts/home.mjs: PROMPTSTUDIO_INSTALL_DIR, else <PROMPTSTUDIO_HOME or %LOCALAPPDATA%\PromptStudio>\app.
$base = if ($env:PROMPTSTUDIO_HOME) { $env:PROMPTSTUDIO_HOME } else { Join-Path $env:LOCALAPPDATA 'PromptStudio' }
$appDir = if ($env:PROMPTSTUDIO_INSTALL_DIR) { $env:PROMPTSTUDIO_INSTALL_DIR } else { Join-Path $base 'app' }
$exe = Join-Path $appDir 'Prompt Studio.exe'
if (-not (Test-Path $exe)) { throw "Installed app not found at $exe. Run 'npm run package' first." }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Prompt Studio.lnk'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path $lnk) {
  $existing = $shell.CreateShortcut($lnk)
  if ($existing.TargetPath -ne $exe) { throw "A different 'Prompt Studio' shortcut already exists ($($existing.TargetPath)). Not replacing it." }
}
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $exe
$s.WorkingDirectory = $appDir
$s.IconLocation = "$exe,0"
$s.Description = 'Prompt Studio - personal prompt development'
$s.Save()
Write-Output "Shortcut: $lnk -> $exe"
