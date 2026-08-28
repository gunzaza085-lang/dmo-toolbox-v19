@echo off
setlocal
title GUN SHOP DMO - Facebook Worker
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Install it from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\playwright-core\package.json" (
  echo First-time setup is required...
  call "%~dp0SETUP-FACEBOOK-WORKER.cmd"
  if errorlevel 1 exit /b 1
)
echo Starting Facebook Worker...
echo Keep this window open while Auto Bump is running.
node facebook-worker\worker.js
echo.
echo Facebook Worker stopped. Press any key to close.
pause >nul
endlocal
