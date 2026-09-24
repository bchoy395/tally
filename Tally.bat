@echo off
REM Double-click to start Tally. It opens in your browser; close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Tally needs Node.js 22.13 or newer. Get it from https://nodejs.org
  pause
  exit /b 1
)
node --disable-warning=ExperimentalWarning server.js %*
