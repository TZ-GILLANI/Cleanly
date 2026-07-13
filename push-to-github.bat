@echo off
setlocal
title Push Cleanly to GitHub
cd /d "%~dp0"
where git >nul 2>nul || (echo Git not found - install from git-scm.com & pause & exit /b 1)
echo.
echo  ==== PUSH CLEANLY TO GITHUB ====
echo.
echo  First: on github.com click + / New repository, name it cleanly,
echo  keep it PRIVATE, click Create. Then copy its URL, e.g.:
echo  https://github.com/YOURNAME/cleanly.git
echo.
set /p REPO=  Paste your repository URL here: 
if "%REPO%"=="" (echo  No URL given & pause & exit /b 1)
if not exist .git git init -b main
git add -A
git -c user.name="Musa Gilani" -c user.email="9999musa72@gmail.com" commit -m "Cleanly v2.6.1 production" >nul 2>&1
git branch -M main
git remote remove origin >nul 2>&1
git remote add origin %REPO%
echo.
echo  Pushing... a browser window may open asking you to sign in to GitHub - do it.
git push -u origin main
if errorlevel 1 (
  echo.
  echo  The repository on GitHub has content ^(e.g. an auto-created README^).
  echo  Overwriting it with YOUR app code is the right move on first push.
  set /p OW=  Overwrite GitHub with local code? [Y/N]: 
  if /i "%OW%"=="Y" (
    git push -u origin main --force
    if errorlevel 1 (echo  Still failed - screenshot for Claude & pause & exit /b 1)
  ) else (
    echo  Cancelled.
    pause
    exit /b 1
  )
)
echo.
echo  DONE! Your code is on GitHub. Next: Render (see PRODUCTION-LAUNCH.md STEP 3)
pause
