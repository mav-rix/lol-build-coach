@echo off
rem Starts both Windows-side helpers for LoL Build Coach in their own windows:
rem   - LCU bridge  (champ-select auto-fill; reads the League client)
rem   - Overlay     (in-game transparent window)
rem The WSL dev server (npm run dev) must be running separately.
rem Both helpers are read-only and idle until the client/game is open.
set NODE=C:\Users\Eric\node-v24.18.0-win-x64
start "LoL Build Coach - LCU Bridge" cmd /k "set PATH=%NODE%;%PATH% && cd /d C:\Users\Eric\lol-lcu-bridge && node bridge.js"
start "LoL Build Coach - Overlay" cmd /k "set PATH=%NODE%;%PATH% && cd /d C:\Users\Eric\lol-overlay && node_modules\.bin\electron.cmd ."
