' RushPoint — hidden auto-start launcher for the playtest tunnel supervisor.
' Task Scheduler runs this at login (via wscript.exe). It starts
' scripts/playtest-forever.mjs COMPLETELY HIDDEN (no console window) and detached,
' so the ngrok tunnel + full local stack come up automatically and stay up.
' All output still lands in .firebase/playtest-forever.log (the supervisor writes it).
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)   ' ...\scripts
root      = fso.GetParentFolderName(scriptDir)                ' project root
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
' 0 = hidden window, False = don't wait (fire-and-forget; the supervisor lives on).
sh.Run "cmd /c node scripts\playtest-forever.mjs", 0, False
