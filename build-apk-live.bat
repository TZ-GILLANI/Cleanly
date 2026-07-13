@echo off
setlocal
title Build Cleanly LIVE Android app
echo.
echo  ==== CLEANLY LIVE APP BUILD (connects to your real server) ====
echo  Prerequisite: .env.production contains your real Render URL.
echo.
cd /d "%~dp0"
findstr /C:"REPLACE-WITH" .env.production >nul && (echo  ERROR: .env.production still has the placeholder URL! Edit it first. & pause & exit /b 1)
set VITE_USE_API=true
if not defined JAVA_HOME if exist "C:\Program Files\Android\Android Studio\jbr" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "SDKP=%LOCALAPPDATA:\=/%/Android/Sdk"
if exist "%LOCALAPPDATA%\Android\Sdk" echo sdk.dir=%SDKP%> android\local.properties
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if not exist node_modules call npm install --no-audit --no-fund
call npm run build || (echo Build failed & pause & exit /b 1)
call npx cap sync android || (echo Sync failed & pause & exit /b 1)
cd android
call gradlew.bat assembleDebug || (echo Gradle failed - screenshot for Claude & pause & exit /b 1)
echo.
echo  LIVE APK ready: android\app\build\outputs\apk\debug\app-debug.apk
echo  (For the Play Store you will use the .aab from Codemagic instead.)
explorer app\build\outputs\apk\debug
pause
