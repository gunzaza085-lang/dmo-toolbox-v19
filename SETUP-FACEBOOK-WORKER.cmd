@echo off
setlocal
title GUN SHOP DMO - Facebook Worker Setup
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Please install Node.js 20 or newer from https://nodejs.org/
  pause
  exit /b 1
)

node -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=20?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  pause
  exit /b 1
)

where chrome >nul 2>nul
if errorlevel 1 (
  if not exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" if not exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" if not exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    echo [ERROR] Google Chrome is required. Install Chrome and run setup again.
    pause
    exit /b 1
  )
)

echo Installing verified Worker dependencies...
call npm ci --omit=dev
if errorlevel 1 (
  echo [ERROR] Dependency installation failed.
  pause
  exit /b 1
)

echo.
echo Setup completed. Run START-FACEBOOK-WORKER.cmd
pause
endlocal
