# RushPoint — one-shot unattended setup for a second Windows machine (a spare PC
# meant to host the always-on playtest tunnel 24/7).
# Installs Node / Git / Java 21 if missing, clones the repo, wires up env files
# (including the .tunnel.env you copied next to this script), installs deps + the
# Firebase CLI, builds the shared package, and turns on permanent auto-start (same
# mechanism proven on the primary machine: scripts/playtest-autostart.ps1 → a
# hidden Windows Scheduled Task that keeps the ngrok tunnel + local Firebase
# emulator stack alive forever).
#
# Usage: put this file + playtest-oldpc-setup.bat + your copied .tunnel.env all in
# the SAME folder (e.g. the Desktop — NOT inside the repo), then double-click the
# .bat file. Safe to re-run if anything fails partway — every step is idempotent.
# If Node/Git/Java get installed, it will ask you to reopen and run once more.

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoUrl   = 'https://github.com/Ahiyasavir/RushPoint.git'
$Branch    = 'topographic-maps'
$RepoDir   = Join-Path $ScriptDir 'RushPoint'
$TunnelSrc = Join-Path $ScriptDir '.tunnel.env'

function Section($title) {
  Write-Host ''
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Test-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# ── 1. .tunnel.env must already be sitting next to this script ──────────────────
Section '1/8 — checking for .tunnel.env'
if (-not (Test-Path $TunnelSrc)) {
  Write-Host ''
  Write-Host 'MISSING: .tunnel.env was not found next to this script.' -ForegroundColor Red
  Write-Host "Copy it from the other computer's RushPoint repo root into:"
  Write-Host "  $ScriptDir"
  Write-Host 'Then run this script again.'
  Write-Host ''
  Read-Host 'Press Enter to close'
  exit 1
}
Write-Host 'Found .tunnel.env.' -ForegroundColor Green

# ── 2. Node.js + Git + Java 21 (the emulator needs a JDK >= 21) ───────────────
Section '2/10 — checking Node.js, Git and Java 21'

# Report the major version of the java on PATH (0 if java is missing).
function Get-JavaMajor {
  if (-not (Test-Cmd 'java')) { return 0 }
  try {
    $out = (& java -version 2>&1 | Out-String)
    if ($out -match '"(\d+)') { return [int]$Matches[1] }
  } catch { }
  return 0
}

$needInstall = $false
if (-not (Test-Cmd 'node')) {
  Write-Host 'Node.js not found - installing (silent)...'
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  $needInstall = $true
}
if (-not (Test-Cmd 'git')) {
  Write-Host 'Git not found - installing (silent)...'
  winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
  $needInstall = $true
}
if ((Get-JavaMajor) -lt 21) {
  Write-Host 'Java 21+ not found - installing Eclipse Temurin 21 JDK (silent)...'
  winget install -e --id EclipseAdoptium.Temurin.21.JDK --silent --accept-package-agreements --accept-source-agreements
  $needInstall = $true
}
if ($needInstall) {
  Write-Host ''
  Write-Host 'Node.js, Git and/or Java were just installed. Windows needs a fresh' -ForegroundColor Yellow
  Write-Host 'terminal session to pick up the new PATH. Please close this window and' -ForegroundColor Yellow
  Write-Host 'double-click the .bat file again to continue.' -ForegroundColor Yellow
  Read-Host 'Press Enter to close'
  exit 0
}
Write-Host ("Node {0} / Git {1} / Java major {2}" -f (node --version), (git --version), (Get-JavaMajor))

# ── 3. Clone or update the repo ──────────────────────────────────────────────
Section '3/10 — getting the RushPoint repo'
if (-not (Test-Path $RepoDir)) {
  git clone --branch $Branch $RepoUrl $RepoDir
} else {
  Write-Host 'Repo already present — updating...'
  Push-Location $RepoDir
  git fetch origin
  git checkout $Branch
  git pull origin $Branch
  Pop-Location
}
Set-Location $RepoDir

# ── 4. Copy .tunnel.env into the repo root ───────────────────────────────────
Section '4/10 — installing .tunnel.env'
Copy-Item -Path $TunnelSrc -Destination (Join-Path $RepoDir '.tunnel.env') -Force
Write-Host 'Copied.' -ForegroundColor Green

# ── 5. Write the app env files (public client config — safe to embed) ────────
Section '5/10 — writing app env files'
$creatorEnv = @'
VITE_FIREBASE_API_KEY=AIzaSyDNnaVjc8-zHFa9OZl3vuZIT61HL1azdww
VITE_FIREBASE_AUTH_DOMAIN=rushpoint-pwa-7daaa.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=rushpoint-pwa-7daaa
VITE_FIREBASE_STORAGE_BUCKET=rushpoint-pwa-7daaa.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=896210540944
VITE_FIREBASE_APP_ID=1:896210540944:web:4cc4e0a0b03ee398f57b15
VITE_RUSHPOINT_APP_ID=rushpoint-pwa-7daaa
'@
$playEnv = @'
VITE_FIREBASE_API_KEY=AIzaSyDNnaVjc8-zHFa9OZl3vuZIT61HL1azdww
VITE_FIREBASE_AUTH_DOMAIN=rushpoint-pwa-7daaa.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=rushpoint-pwa-7daaa
VITE_FIREBASE_STORAGE_BUCKET=rushpoint-pwa-7daaa.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=896210540944
VITE_FIREBASE_APP_ID=1:896210540944:web:4cc4e0a0b03ee398f57b15
'@
Set-Content -Path (Join-Path $RepoDir 'apps\creator-web\.env') -Value $creatorEnv -Encoding utf8 -NoNewline
Set-Content -Path (Join-Path $RepoDir 'apps\play-web\.env')    -Value $playEnv    -Encoding utf8 -NoNewline
Write-Host 'Written.' -ForegroundColor Green

# ── 6. npm install ────────────────────────────────────────────────────────────
Section '6/10 — npm install (this can take a few minutes on first run)'
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed - see output above.' }

# ── 7. Firebase CLI (global) — the emulator invokes bare `firebase` ──────────
Section '7/10 — Firebase CLI (firebase-tools)'
if (-not (Test-Cmd 'firebase')) {
  Write-Host 'firebase-tools not found - installing globally (a few minutes)...'
  npm install -g firebase-tools
  if ($LASTEXITCODE -ne 0) { throw 'npm install -g firebase-tools failed - see output above.' }
  # npm's global bin dir is on PATH but was empty until now; make sure THIS
  # process can resolve the freshly-installed `firebase` for the verify step.
  $env:PATH = "$env:APPDATA\npm;$env:PATH"
}
Write-Host ("firebase {0}" -f (firebase --version 2>$null))

# ── 8. Build the shared package (its dist/ is gitignored → absent on a fresh
#      clone; the proxy and both web apps import it at runtime) ───────────────
Section '8/10 — building @rushpoint/shared'
npm run shared:build
if ($LASTEXITCODE -ne 0) { throw 'shared:build failed - see output above.' }

# ── 9. Install permanent auto-start ──────────────────────────────────────────
Section '9/10 — installing permanent auto-start'
npm run autostart:install
if ($LASTEXITCODE -ne 0) { throw 'autostart:install failed - see output above.' }

# ── 10. Trigger it now and verify it actually comes up ───────────────────────
Section '10/10 — starting the stack now and verifying'
Start-ScheduledTask -TaskName 'RushPoint Playtest Tunnel'
Write-Host 'Started. Waiting up to 3 minutes for the whole stack to come up...'

# Success = the local proxy on :3000 is actually accepting connections. The ngrok
# URL prints even when the upstream is down, so we verify the real upstream, not
# just the tunnel banner.
$logPath = Join-Path $RepoDir '.firebase\playtest-forever.log'
$deadline = (Get-Date).AddSeconds(180)
$success = $false
$conflict = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    $success = $true; break
  }
  if (Test-Path $logPath) {
    $tail = Get-Content $logPath -Tail 40 -ErrorAction SilentlyContinue
    if ($tail -match 'ERR_NGROK_?8|already.*online|simultaneous|failed to start tunnel') { $conflict = $true; break }
  }
}

Write-Host ''
if ($success) {
  Write-Host 'SUCCESS - the stack is live on THIS computer (proxy :3000 is up).' -ForegroundColor Green
  if (Test-Path $logPath) { Get-Content $logPath -Tail 60 | Select-String 'ngrok\]' | Select-Object -Last 5 }
  Write-Host ''
  Write-Host 'It will now start automatically ~20 seconds after every login on this' -ForegroundColor Green
  Write-Host 'machine, forever. You can now safely shut down the OTHER computer.' -ForegroundColor Green
} elseif ($conflict) {
  Write-Host 'The other computer is still running and holding the tunnel domain.' -ForegroundColor Yellow
  Write-Host 'Shut down / stop the tunnel on the OTHER computer, then run this script' -ForegroundColor Yellow
  Write-Host 'again (it is safe to re-run - everything is already set up).' -ForegroundColor Yellow
} else {
  Write-Host 'Could not confirm the proxy on :3000 within 3 minutes. Check the log:' -ForegroundColor Yellow
  Write-Host "  $logPath"
}
Write-Host ''
Read-Host 'Press Enter to close'
