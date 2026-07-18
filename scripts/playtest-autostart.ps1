<#
  Install / remove a Windows Scheduled Task that auto-starts the RushPoint playtest
  tunnel at every login. The task launches scripts/playtest-autostart.vbs (hidden),
  which starts the playtest:forever supervisor (keeps ngrok + the full local stack
  up, auto-restarting on any crash).

    npm run autostart:install      # register the login task (runs now-onward, every login)
    npm run autostart:uninstall    # remove it
    npm run autostart:status       # show whether it's registered + last run

  Stopping the tunnel itself (without removing autostart) is separate:
    npm run playtest:stop
#>
param([ValidateSet('install','uninstall','status')] [string] $Action = 'install')

$ErrorActionPreference = 'Stop'
$TaskName = 'RushPoint Playtest Tunnel'
$root = Split-Path -Parent $PSScriptRoot
$vbs  = Join-Path $PSScriptRoot 'playtest-autostart.vbs'
$user = "$env:USERDOMAIN\$env:USERNAME"

switch ($Action) {
  'install' {
    $taskAction  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $root

    # Trigger 1 — at every logon (covers a fresh boot the moment you sign in).
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
    $logon.Delay = 'PT20S'   # let the network/JDK settle after login before booting the emulator

    # Trigger 2 — a watchdog that fires every 5 minutes, indefinitely. Because the
    # supervisor is single-instance (scripts/playtest-forever.mjs exits on a live pid),
    # this is a no-op when the tunnel is already up, and RESTARTS it after the cases a
    # logon trigger misses: resume-from-sleep / lid close-open, hibernate, or a crash
    # of the supervisor itself. This is what makes it genuinely 24/7 while logged in.
    $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date) `
      -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

    $taskSettings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -MultipleInstances IgnoreNew
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger @($logon, $watchdog) `
      -Settings $taskSettings -Principal $taskPrincipal -Force | Out-Null
    Write-Host "Installed 24/7 task '$TaskName'." -ForegroundColor Green
    Write-Host "  - starts ~20s after each login, AND re-checks every 5 min (restarts after sleep/crash)."
    Write-Host "  - auto-pulls git pushes on the tracked branch and restarts the stack (fixed link stays)."
  }
  'uninstall' {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host "Removed login task '$TaskName'. (Tunnel keeps running until you run: npm run playtest:stop)" -ForegroundColor Yellow
    } else {
      Write-Host "No task named '$TaskName' is registered."
    }
  }
  'status' {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $t) { Write-Host "Not installed."; break }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task    : $TaskName"
    Write-Host "State   : $($t.State)"
    Write-Host "LastRun : $($info.LastRunTime)  (result $($info.LastTaskResult))"
    Write-Host "NextRun : $($info.NextRunTime)"
  }
}
