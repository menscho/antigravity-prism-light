@echo off
rem Antigravity Prism Light: one-click uninstall. Runs tools\install-plugin.cjs --uninstall from this folder.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity Prism Light - Uninstall

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found, so the uninstaller cannot run.
  echo  Install Node.js from https://nodejs.org, or delete these by hand:
  echo    %USERPROFILE%\.gemini\config\plugins\obsidian-prism
  echo    the "Antigravity (Prism)" shortcut on your Desktop and in the Start Menu
  echo.
  pause
  exit /b 1
)

echo.
echo  Removing Antigravity Prism Light...
echo.
node tools\install-plugin.cjs --uninstall
if errorlevel 1 (
  echo.
  echo  Uninstall failed. See the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo  Done. Restart Antigravity to finish.
echo.
pause
