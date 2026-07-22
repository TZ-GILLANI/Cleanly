@echo off
setlocal
title Set Cleanly CEO (super admin) account
cd /d "%~dp0"
echo.
echo  ==== SET CEO SUPER-ADMIN (production database) ====
echo.
echo  CEO email is fixed to: musagillani@tzmanufacturing.com
echo  (Run WIPE-TEST-DATA.sql in Supabase FIRST if you want a clean slate.)
echo.
echo  Paste the Supabase connection string (URI with your password in it):
set /p DATABASE_URL=  DATABASE_URL:
set ADMIN_EMAIL=musagillani@tzmanufacturing.com
set /p ADMIN_PASSWORD=  Choose CEO password (min 10 chars):
call npm install --no-audit --no-fund
node server/seed-prod.js
echo.
echo  Done. Log in at https://cleanly-2x9z.onrender.com with the email above.
pause
