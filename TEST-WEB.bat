@echo off
setlocal
title Cleano - local walkthrough
cd /d "%~dp0"

echo.
echo   ================================================================
echo    CLEANO - LOCAL WALKTHROUGH
echo   ================================================================
echo.
echo    Everything runs on this computer. It does not touch your live
echo    site, your Supabase database, Stripe, or any real customer.
echo    The database is in memory - it disappears when you close this.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo    Node.js is not installed. Get the LTS from https://nodejs.org
  echo    then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo    First run: installing packages. This takes a minute or two...
  echo.
  call npm install --no-audit --no-fund
)

rem Points the app at the local API. The name matters: Vite only reads
rem .env.development.local when running the dev server. A production
rem build ignores it completely, so if this file is ever left behind it
rem cannot bake "localhost" into an app that goes to the stores.
> .env.development.local echo VITE_USE_API=true
>> .env.development.local echo VITE_API_BASE=http://localhost:3001

rem PGMEM keeps the database in memory. DEMO_SEED fills it with a
rem business worth clicking through. Both are required, and the seed
rem refuses to run without PGMEM, so there is no route to real data.
set PGMEM=1
set DEMO_SEED=1
set JWT_SECRET=local-walkthrough-only
set PORT=3001
set NODE_ENV=development

echo.
echo    Starting the API - your login details will appear in the
echo    window that opens next. Keep both windows open.
echo.
start "Cleano API  -  YOUR LOGINS ARE IN HERE" cmd /k "node server/index.js"

echo    Starting the app at http://localhost:5173
echo    The browser opens on its own in a few seconds.
echo.
start "" cmd /c "timeout /t 14 >nul & start http://localhost:5173"

call npx vite --port 5173

del /q .env.local >nul 2>nul
echo.
echo    Stopped. You can close the API window too.
pause
