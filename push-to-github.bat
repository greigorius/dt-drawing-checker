@echo off
setlocal

:: ── Prompt for commit message ─────────────────────────────────────────────────
set /p MSG="Commit message (leave blank to use 'Update'): "
if "%MSG%"=="" set MSG=Update

echo.
echo Staging all changes (respecting .gitignore)...
git add -A

echo.
echo Changes to be committed:
git status --short

echo.
set /p CONFIRM="Commit and push? (y/n): "
if /i not "%CONFIRM%"=="y" (
  echo Cancelled.
  exit /b 0
)

git commit -m "%MSG%"
if errorlevel 1 (
  echo Nothing to commit or commit failed.
  exit /b 1
)

echo.
echo Pushing to GitHub...
git push origin master
if errorlevel 1 (
  echo Push failed. Check your network or branch name.
  exit /b 1
)

echo.
echo Done! Changes pushed to GitHub.
echo.
echo NOTE: Netlify auto-deploys on push if connected to this repo.
echo       Check https://app.netlify.com for deploy status.

endlocal
pause
