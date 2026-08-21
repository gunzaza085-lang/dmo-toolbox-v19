@echo off
title GUN SHOP DMO - Facebook Worker
cd /d "%~dp0"
echo Starting Facebook Worker...
echo Keep this window open while Auto Bump is running.
node facebook-worker\worker.js
echo.
echo Facebook Worker stopped. Press any key to close.
pause >nul
