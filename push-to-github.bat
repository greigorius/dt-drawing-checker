@echo off
setlocal

:: ── Prompt for commit message ─────────────────────────────────────────────────
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm:ss\""') do set DATETIME=%%i
set DEFAULT_MSG=Update %DATETIME%
set /p MSG="Commit message (leave blank for '%DEFAULT_MSG%'): "
if "%MSG%"=="" set MSG=%DEFAULT_MSG%

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
echo Done! Changes