@echo off
chcp 65001 >nul
if "%~1"=="--foreground" (
  shift
  node "%~dp0..\..\inject.js" --watch %1 %2 %3 %4 %5
) else (
  start "" /b /d "%~dp0..\.." node "%~dp0..\..\inject.js" --watch
)
