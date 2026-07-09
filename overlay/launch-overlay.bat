@echo off
rem Launches the LoL Build Coach in-game overlay.
rem Requires the dev server running in WSL (npm run dev) and the game in
rem Borderless/Windowed mode.
set PATH=C:\Users\Eric\node-v24.18.0-win-x64;%PATH%
cd /d C:\Users\Eric\lol-overlay
start "" node_modules\.bin\electron.cmd .
