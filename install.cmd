@echo off
rem Antigravity Prism Light: one-click install. Runs tools\install-plugin.cjs --install from this folder.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity Prism Light - Install

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found.
  echo  Install Node.js 22 or newer from https://nodejs.org and run install.cmd again.
  echo.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=v." %%a in ('node --version') do set "NODE_MAJOR=%%a"
if not defined NODE_MAJOR set "NODE_MAJOR=0"
if %NODE_MAJOR% LSS 22 (
  echo.
  echo  Node.js 22 or newer is required. You have:
  node --version
  echo  Update it from https://nodejs.org and run install.cmd again.
  echo.
  pause
  exit /b 1
)

echo.
echo  Installing Antigravity Prism Light...
echo.
node tools\install-plugin.cjs --install
if errorlevel 1 (
  echo.
  echo  Install failed. See the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo  Done.
echo  1. Close Antigravity completely (all windows).
echo  2. Open it with the "Antigravity (Prism)" shortcut on your Desktop or in the Start Menu.
echo.
pause
