@echo off
setlocal EnableDelayedExpansion
title Reset PostgreSQL password
rem ── must run elevated ──
net session >nul 2>nul || (
  echo  Please RIGHT-CLICK this file and choose "Run as administrator".
  pause
  exit /b 1
)

rem ── locate PostgreSQL ──
set "PGDIR="
for /d %%v in ("C:\Program Files\PostgreSQL\*") do if exist "%%v\bin\psql.exe" set "PGDIR=%%v"
if not defined PGDIR (echo  PostgreSQL not found & pause & exit /b 1)
set "DATA=%PGDIR%\data"
if not exist "%DATA%\pg_hba.conf" (echo  Data folder not found at %DATA% & pause & exit /b 1)

rem ── locate service name ──
set "SVC="
for /f "tokens=2" %%s in ('sc query state^= all ^| findstr /i "postgresql"') do if not defined SVC set "SVC=%%s"
if not defined SVC (echo  PostgreSQL service not found & pause & exit /b 1)
echo  Found: %PGDIR%   service: %SVC%
echo.
set /p NEWPW=  Choose a NEW postgres password (letters+numbers only): 
if "%NEWPW%"=="" (echo  Empty password - aborting & pause & exit /b 1)

echo  Temporarily opening local access...
copy /y "%DATA%\pg_hba.conf" "%DATA%\pg_hba.conf.bak" >nul
powershell -Command "(Get-Content '%DATA%\pg_hba.conf') -replace 'scram-sha-256','trust' -replace 'md5','trust' | Set-Content '%DATA%\pg_hba.conf'"
net stop %SVC% >nul 2>nul
net start %SVC% >nul 2>nul
timeout /t 3 >nul

echo  Setting new password...
"%PGDIR%\bin\psql.exe" -U postgres -h localhost -c "ALTER USER postgres WITH PASSWORD '%NEWPW%'" || (
  echo  Failed - restoring settings...
  copy /y "%DATA%\pg_hba.conf.bak" "%DATA%\pg_hba.conf" >nul
  net stop %SVC% >nul 2>nul & net start %SVC% >nul 2>nul
  pause & exit /b 1
)

echo  Restoring secure settings...
copy /y "%DATA%\pg_hba.conf.bak" "%DATA%\pg_hba.conf" >nul
net stop %SVC% >nul 2>nul
net start %SVC% >nul 2>nul
echo.
echo  DONE. Your postgres password is now: %NEWPW%
echo  Now double-click test-fullstack.bat and use it.
pause
