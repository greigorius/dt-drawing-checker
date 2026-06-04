@echo off
cd /d "%~dp0"

echo ====================================
echo  DT Drawing Checker - Dev Server
echo ====================================

:: Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo Installing root dependencies...
  call npm install
)
if not exist "client\node_modules" (
  echo Installing client dependencies...
  cd client && call npm install && cd ..
)

echo.
echo Starting servers...
echo  - Express API:  http://localhost:3001
echo  - Vite client:  http://localhost:5174
echo.

:: Start servers in background, then open Chrome
start "DT Drawing Checker" cmd /k "npm run dev"

:: Wait a moment for Vite to be ready, then open browser
timeout /t 3 /nobreak >nul
start chrome http://localhost:5174
