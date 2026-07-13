@echo off
title Cleanly ORIGINAL demo
echo.
echo  ==== CLEANLY (original design) DEMO ====
echo.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Get the LTS from https://nodejs.org then run this again.
  pause
  exit /b 1
)
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if not exist node_modules (
  echo  First run: installing packages, takes 1-2 minutes...
  call npm install --no-audit --no-fund
)
echo.
echo  Starting Cleanly at http://localhost:5173  (demo mode - use the role switcher in the top bar)
echo  Keep this window open. Press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm run client
pause
