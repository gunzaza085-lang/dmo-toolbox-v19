@echo off
setlocal
title GUN SHOP DMO - Facebook Worker
cd /d "%~dp0"

if /I not "%OS%"=="Windows_NT" (
  echo [ERROR] This package supports Windows only.
  goto :failed
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  echo Install it from https://nodejs.org/ then run this file again.
  goto :failed
)
if not exist "node_modules\playwright-core\package.json" (
  echo First-time setup is required...
  call "%~dp0SETUP-FACEBOOK-WORKER.cmd"
  if errorlevel 1 goto :failed
)

node "%~dp0facebook-worker\portable-preflight.js" start
set "PREFLIGHT_EXIT=%ERRORLEVEL%"
if "%PREFLIGHT_EXIT%"=="10" goto :already_running
if not "%PREFLIGHT_EXIT%"=="0" goto :failed

echo Starting Facebook Worker...
echo Keep this window open while Auto Bump is running.
node "%~dp0facebook-worker\worker.js"
if errorlevel 1 goto :failed
echo.
echo Facebook Worker stopped. Press any key to close.
if not defined FACEBOOK_WORKER_NO_PAUSE pause >nul
endlocal
exit /b 0

:already_running
echo [OK] No second Worker was started.
if not defined FACEBOOK_WORKER_NO_PAUSE pause
endlocal
exit /b 0

:failed
if not defined FACEBOOK_WORKER_NO_PAUSE pause
endlocal
exit /b 1
