@echo off
setlocal
cd /d "%~dp0"
netstat -ano | findstr /R /C:":17821 .*LISTENING" >nul
if not errorlevel 1 (
  echo Facebook Worker is already running on port 17821.
  pause
  exit /b 1
)
echo Starting GUN SHOP DMO Facebook Worker...
echo Keep this window open while Facebook Auto Bump is in use.
node facebook-worker\worker.js
if errorlevel 1 (
  echo.
  echo Facebook Worker stopped with an error.
  pause
)
