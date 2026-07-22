@echo off
setlocal
title Create Cleanly production admin
cd /d "%~dp0"
echo.
echo  ==== CREATE YOUR ADMIN ACCOUNT (production database) ====
echo.
echo  Paste the Supabase connection string (URI with your password in it):
set /p DATABASE_URL=  DATABASE_URL: 
set /p ADMIN_EMAIL=  Your admin email: 
set /p ADMIN_PASSWORD=  Admin password (min 10 chars): 
call npm install --no-audit --no-fund
node server/seed-prod.js
pause
