@echo off
rem Double-clickable installer. Pass your extension ID (from chrome://extensions).
rem   install.bat abcdefghijklmnopabcdefghijklmnop
setlocal
set "ID=%~1"
if "%ID%"=="" (
  echo.
  echo   Usage: install.bat ^<extension-id^>
  echo.
  echo   1. Load this extension unpacked in Chrome ^(chrome://extensions, Developer mode^).
  echo   2. Copy its ID.
  echo   3. Run:  install.bat ^<that-id^>
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -ExtensionId "%ID%"
echo.
pause
