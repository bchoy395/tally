@echo off
REM Double-click to start Tally. It opens in your browser; close this window to stop it.
setlocal
set "HERE=%~dp0"
REM A copy inside WSL (\\wsl.localhost\<distro>\... or \\wsl$\...) runs in that Linux distro, with its Node and data.
if /i "%HERE:~0,16%"=="\\wsl.localhost\" goto wsl
if /i "%HERE:~0,7%"=="\\wsl$\" goto wsl
where node >nul 2>nul
if errorlevel 1 (
  echo Tally needs Node.js 22.13 or newer. Get it from https://nodejs.org
  pause
  exit /b 1
)
node --disable-warning=ExperimentalWarning "%HERE%server.js" %*
exit /b

:wsl
for /f "tokens=2,* delims=\" %%a in ("%HERE%") do (
  set "DISTRO=%%a"
  set "LINUXDIR=/%%b"
)
set "LINUXDIR=%LINUXDIR:\=/%"
REM No quotes around the distro: wsl.exe doesn't strip them there.
wsl.exe -d %DISTRO% --cd "%LINUXDIR%" -- bash Tally.command %*
