@echo off
rem Launches the LoL Build Coach LCU bridge (reads champ-select from the League
rem client, imports builds as rune pages/item sets). Leave this running while
rem you play; it does nothing until the client is open. Never sends picks/bans.
set PATH=C:\Users\Eric\node-v24.18.0-win-x64;%PATH%
cd /d C:\Users\Eric\lol-lcu-bridge
node bridge.js
