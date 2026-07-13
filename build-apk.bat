@echo off
setlocal
title Build Cleanly Android APK
echo.
echo  ==== CLEANLY - ANDROID APK BUILD ====
echo  Builds an installable demo APK (self-contained, no server needed).
echo.
cd /d "%~dp0"
where node >nul 2>nul || (echo  Node.js missing - install from nodejs.org & pause & exit /b 1)

rem Demo mode for this first APK (works offline; switch later per PRODUCTION-LAUNCH.md)
set VITE_USE_API=false

rem Java: use Android Studio bundled JDK if none set
if not defined JAVA_HOME if exist "C:\Program Files\Android\Android Studio\jbr" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
if not defined JAVA_HOME (echo  Android Studio JDK not found - open Android Studio once, then retry & pause & exit /b 1)
echo  Using JAVA_HOME=%JAVA_HOME%

rem Android SDK path for gradle
set "SDKP=%LOCALAPPDATA:\=/%/Android/Sdk"
if exist "%LOCALAPPDATA%\Android\Sdk" echo sdk.dir=%SDKP%> android\local.properties

set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if not exist node_modules (echo  Installing packages... & call npm install --no-audit --no-fund)

echo  [1/3] Building the app bundle...
call npm run build || (echo  Build failed & pause & exit /b 1)
echo  [2/3] Syncing into the Android project...
call npx cap sync android || (echo  Sync failed & pause & exit /b 1)
echo  [3/3] Compiling the APK (first time downloads Gradle, 3-10 min)...
cd android
call gradlew.bat assembleDebug || (echo  Gradle build failed - send Claude a screenshot & pause & exit /b 1)
echo.
echo  ==========================================================
echo   DONE! Your installable app:
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo   Send it to your phone (WhatsApp/USB) and open it.
echo  ==========================================================
explorer app\build\outputs\apk\debug
pause
