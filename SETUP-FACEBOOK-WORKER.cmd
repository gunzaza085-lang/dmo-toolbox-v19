@echo off
setlocal
title GUN SHOP DMO - Facebook Worker Setup
cd /d "%~dp0"

if /I not "%OS%"=="Windows_NT" (
  echo [ERROR] This package supports Windows only.
  goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Please install Node.js 20 or newer from https://nodejs.org/
  goto :failed
)

node -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=20?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  goto :failed
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js 20 or newer.
  goto :failed
)

node "%~dp0facebook-worker\portable-preflight.js" setup
set "PREFLIGHT_EXIT=%ERRORLEVEL%"
if "%PREFLIGHT_EXIT%"=="10" goto :already_running
if not "%PREFLIGHT_EXIT%"=="0" goto :failed

echo Installing verified Worker dependencies...
call npm ci --omit=dev
if errorlevel 1 (
  echo [ERROR] Dependency installation failed. Check your internet connection and try again.
  goto :failed
)

echo.
echo Setup completed. Run START-FACEBOOK-WORKER.cmd
goto :success

:already_running
echo [OK] Setup is already usable because the Worker is running.

:success
if not defined FACEBOOK_WORKER_NO_PAUSE pause
endlocal
exit /b 0

:failed
if not defined FACEBOOK_WORKER_NO_PAUSE pause
endlocal
exit /b 1
