@echo off
setlocal
title Push Cleanly to GitHub
cd /d "%~dp0"
where git >nul 2>nul || (echo Git not found - install from git-scm.com & pause & exit /b 1)
echo.
echo  ==== PUSH CLEANLY TO GITHUB ====
echo.
echo   Your repository is:  https://github.com/TZ-GILLANI/Cleanly.git
echo.
set /p REPO=  Paste it here (or press Enter to use it): 
if "%REPO%"=="" set REPO=https://github.com/TZ-GILLANI/Cleanly.git
if "%REPO%"=="" (echo  No URL given & pause & exit /b 1)
if not exist .git git init -b main
git add -A
git -c user.name="Musa Gilani" -c user.email="9999musa72@gmail.com" commit -m "Cleano v7.1.1" >nul 2>&1
git branch -M main
git remote remove origin >nul 2>&1
git remote add origin %REPO%
echo.
echo  Pushing... sign in to GitHub if a browser window opens.
git push -u origin main
if not errorlevel 1 goto success
echo.
echo  GitHub has content there (the auto-created README). Overwriting it
echo  with your app code is correct on the first push.
set /p OW=  Overwrite GitHub with local code? [Y/N]: 
if /i not "%OW%"=="Y" goto cancelled
git push -u origin main --force
if not errorlevel 1 goto success
echo  Still failed - screenshot this window for Claude
pause
exit /b 1
:cancelled
echo  Cancelled.
pause
exit /b 1
:success
echo.
echo  ==========================================
echo   DONE! Your code is on GitHub.
echo   Next: Supabase schema, then Render.
echo  ==========================================
pause
