@echo off
rem Launches the LoL Build Coach LCU bridge (reads champ-select from the League
rem client). Leave this running while you play; it does nothing until the client
rem is open. Read-only — never sends picks/bans to the client.
set PATH=C:\Users\Eric\node-v24.18.0-win-x64;%PATH%
cd /d C:\Users\Eric\lol-lcu-bridge
node bridge.js
