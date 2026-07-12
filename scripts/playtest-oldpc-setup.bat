@echo off
REM Double-click this file. It runs playtest-oldpc-setup.ps1 next to it.
REM Put your copied .tunnel.env in the SAME folder as these two files first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0playtest-oldpc-setup.ps1"
