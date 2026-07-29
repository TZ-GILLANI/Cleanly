@echo off
setlocal enabledelayedexpansion
title Cleano - Create your Android signing key
color 0B
echo.
echo  ===================================================================
echo   CLEANO - ANDROID SIGNING KEY (keystore)
echo  ===================================================================
echo.
echo   This creates ONE file that proves every future update of the
echo   Cleano Android app really comes from you.
echo.
echo   *** LOSE THIS FILE = YOU CAN NEVER UPDATE THE APP ON GOOGLE PLAY ***
echo   *** You would have to publish a brand-new app and lose all users ***
echo.
echo   Back it up in at least 2 places (Google Drive + a USB stick).
echo.
pause

REM ---------- find keytool (Java) ----------
set "KT="
where keytool >nul 2>nul && set "KT=keytool"
if not defined KT if exist "%JAVA_HOME%\bin\keytool.exe" set "KT=%JAVA_HOME%\bin\keytool.exe"
if not defined KT (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Android Studio*" "%ProgramFiles%\Android\Android Studio*") do (
    if exist "%%~D\jbr\bin\keytool.exe" set "KT=%%~D\jbr\bin\keytool.exe"
    if exist "%%~D\jre\bin\keytool.exe" set "KT=%%~D\jre\bin\keytool.exe"
  )
)
if not defined KT (
  for /d %%D in ("%ProgramFiles%\Java\jdk*" "%ProgramFiles%\Eclipse Adoptium\jdk*" "%ProgramFiles%\Microsoft\jdk*") do (
    if exist "%%~D\bin\keytool.exe" set "KT=%%~D\bin\keytool.exe"
  )
)

if not defined KT (
  color 0E
  echo.
  echo   Java was not found on this PC, so the key cannot be created here.
  echo.
  echo   EASIEST FIX - install Java once, then run this file again:
  echo     1. Go to:  https://adoptium.net
  echo     2. Download "Temurin 17 (LTS)" for Windows x64  [the .msi]
  echo     3. Install it with all default options
  echo     4. Close this window and double-click this file again
  echo.
  pause
  exit /b 1
)
echo   Java found: !KT!
echo.

REM ---------- collect passwords ----------
echo  -------------------------------------------------------------------
echo   Choose a password for the key. Use something you will NOT forget -
echo   it can never be recovered or reset. Write it down with the backup.
echo   At least 6 characters, no spaces.
echo  -------------------------------------------------------------------
echo.
set "PW1="
set /p PW1=Password:
if "!PW1!"=="" (echo  Empty password - cancelled. & pause & exit /b 1)
set "PW2="
set /p PW2=Type it again:
if not "!PW1!"=="!PW2!" (echo. & echo  The two passwords do not match - nothing was created. & pause & exit /b 1)

set "OUT=%USERPROFILE%\Desktop\cleano-upload-key.jks"
if exist "%OUT%" (
  echo.
  echo   A key already exists at: %OUT%
  echo   Creating a second one would BREAK updates if the first is already
  echo   used on Google Play. Only continue if you never uploaded it.
  choice /m "Overwrite the existing key"
  if errorlevel 2 (echo  Cancelled - your existing key was kept. & pause & exit /b 0)
  del "%OUT%"
)

echo.
echo   Creating the key...
"!KT!" -genkeypair -v -keystore "%OUT%" -storetype JKS -keyalg RSA -keysize 2048 ^
  -validity 10000 -alias cleano ^
  -dname "CN=Cleano, OU=Cleano, O=TZ Gillani Kft., L=Debrecen, C=HU" ^
  -storepass "!PW1!" -keypass "!PW1!" >nul 2>nul

if not exist "%OUT%" (
  color 0C
  echo   Something went wrong - the key was not created.
  echo   Take a screenshot of this window and send it to Claude.
  pause
  exit /b 1
)

color 0A
echo.
echo  ===================================================================
echo   DONE - your signing key was created
echo  ===================================================================
echo.
echo   FILE:  %OUT%
echo          (it is on your Desktop, named cleano-upload-key.jks)
echo.
echo   NOW UPLOAD IT TO CODEMAGIC:
echo     1. codemagic.io - open your Cleano app
echo     2. Top-right avatar/team name - Settings
echo     3. "codemagic.yaml settings"  -  "Code signing identities"
echo     4. Open the "Android keystores" tab - Choose a file
echo     5. Pick:  cleano-upload-key.jks   (from your Desktop)
echo     6. Fill in EXACTLY:
echo           Keystore password :  the password you just typed
echo           Key alias         :  cleano
echo           Key password      :  the same password again
echo           Reference name    :  cleano_keystore
echo     7. Click "Add keystore"
echo.
echo   THEN BACK IT UP (do this today):
echo     - Upload cleano-upload-key.jks to Google Drive / OneDrive
echo     - Copy it to a USB stick
echo     - Save the password in your password manager or on paper
echo     Codemagic will NOT let you download it back later.
echo.
echo  ===================================================================
pause
