# Adds "Tangent Graph" to the Start menu and the desktop. The Start menu one also gets
# Ctrl+Alt+T, so the hotkey launches the app even when it isn't running yet.
# Run: npm run shortcuts   (run it again after moving the project folder)
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $exe)) { Write-Error "Electron isn't installed. Run npm install first."; exit 1 }

$shell = New-Object -ComObject WScript.Shell
$places = @(
  @{ Path = Join-Path ([Environment]::GetFolderPath("Programs")) "Tangent Graph.lnk"; Hotkey = "CTRL+ALT+T" },
  @{ Path = Join-Path ([Environment]::GetFolderPath("Desktop")) "Tangent Graph.lnk"; Hotkey = "" }
)
foreach ($p in $places) {
  $s = $shell.CreateShortcut($p.Path)
  $s.TargetPath = $exe
  $s.Arguments = "`"$root`""
  $s.WorkingDirectory = $root
  $s.IconLocation = (Join-Path $root "desktop\icon.ico") + ",0"
  $s.Description = "Keep learning tangents on purpose"
  $s.WindowStyle = 1
  $s.Hotkey = $p.Hotkey
  $s.Save()
  Write-Output "Created $($p.Path)"
}
