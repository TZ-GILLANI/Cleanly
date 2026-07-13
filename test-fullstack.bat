@echo off
setlocal
title Cleanly FULL-STACK test (real database)
echo.
echo  ==== CLEANLY FULL-STACK TEST ====
echo  Real PostgreSQL database + real accounts (API mode)
echo.
cd /d "%~dp0"
where node >nul 2>nul || (echo  Node.js missing - install LTS from nodejs.org & pause & exit /b 1)

rem ── find PostgreSQL ──
set "PSQL="
for /d %%v in ("C:\Program Files\PostgreSQL\*") do if exist "%%v\bin\psql.exe" set "PSQL=%%v\bin\psql.exe"
if not defined PSQL (echo  PostgreSQL not found in C:\Program Files\PostgreSQL & pause & exit /b 1)
echo  Found PostgreSQL: %PSQL%
echo.
echo  Type the password you set for the ^"postgres^" user when PostgreSQL was installed.
echo  (Avoid @ : / characters in it for this test. Nothing is sent anywhere.)
set /p PGPASSWORD=  postgres password: 

rem ── create db if missing, apply schema ──
"%PSQL%" -U postgres -h localhost -tc "SELECT 1 FROM pg_database WHERE datname='cleanly'" 2>nul | findstr 1 >nul
if errorlevel 1 (
  "%PSQL%" -U postgres -h localhost -c "CREATE DATABASE cleanly" || (echo  Could not connect - wrong password? & pause & exit /b 1)
)
echo  Applying schema...
"%PSQL%" -U postgres -h localhost -d cleanly -f schema.sql >nul || (echo  Schema failed & pause & exit /b 1)

rem ── write .env for API mode ──
(
  echo DATABASE_URL=postgresql://postgres:%PGPASSWORD%@localhost:5432/cleanly
  echo JWT_SECRET=local-test-secret-%RANDOM%%RANDOM%%RANDOM%
  echo VITE_USE_API=true
  echo PORT=3001
  echo NODE_ENV=development
) > .env

set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if not exist node_modules (echo  Installing packages, 1-2 min... & call npm install --no-audit --no-fund)

echo  Seeding test accounts (admin@cleanly.hu / admin123 etc, see README)...
call node server/seed.js
echo.
echo  Starting FULL STACK at http://localhost:5173  -  real signups work too!
echo  Keep this window open. Ctrl+C stops it.
echo.
start "" cmd /c "timeout /t 12 >nul & start http://localhost:5173"
call npm run dev
pause
