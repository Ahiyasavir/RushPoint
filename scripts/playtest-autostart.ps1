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
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $taskTrigger.Delay = 'PT20S'   # let the network/JDK settle after login before booting the emulator
    $taskSettings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -MultipleInstances IgnoreNew
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger `
      -Settings $taskSettings -Principal $taskPrincipal -Force | Out-Null
    Write-Host "Installed login task '$TaskName'." -ForegroundColor Green
    Write-Host "It starts the tunnel ~20s after each login (hidden). Fixed link stays the same."
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
