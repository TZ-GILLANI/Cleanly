@echo off
title Firebase key -> clipboard (base64)
echo.
echo  Converts your Firebase service-account JSON to one base64 line
echo  and puts it in the clipboard. Paste it into Render as the value of
echo  FIREBASE_SERVICE_ACCOUNT_B64. The key itself never leaves your PC.
echo.
set "KEYFILE="
for /f "delims=" %%F in ('dir /b /o-d "%USERPROFILE%\Downloads\*firebase-adminsdk*.json" 2^>nul') do if not defined KEYFILE set "KEYFILE=%USERPROFILE%\Downloads\%%F"
if defined KEYFILE (
  echo  Found: %KEYFILE%
  choice /m "Use this file"
  if errorlevel 2 set "KEYFILE="
)
if not defined KEYFILE set /p KEYFILE=Full path to the JSON key file:
if not exist "%KEYFILE%" (echo  File not found. & pause & exit /b 1)
powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('%KEYFILE%')) | Set-Clipboard"
if errorlevel 1 (echo  Conversion failed. & pause & exit /b 1)
echo.
echo  DONE - the base64 value is in your clipboard.
echo  Render dashboard -> cleanly service -> Environment ->
echo  Add: FIREBASE_SERVICE_ACCOUNT_B64  and paste as the value. Save.
echo.
echo  SECURITY: consider deleting the JSON from Downloads afterwards -
echo  anyone with that file can send pushes as your app.
pause
