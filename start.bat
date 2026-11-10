@echo off
title ARCNAVE
cd /d "%~dp0"
rem ARCNAVE v0.38: double-click to start; the browser opens http://localhost:8083 by itself.
rem Node is looked for: next to this file (node\node.exe, from the share zip), then the team PC's portable Node folders, then the computer.
if not exist "%~dp0server.js" (
  echo This start.bat is not inside the unzipped ARCNAVE folder.
  echo Opening it straight from the zip does not work: right-click the zip, choose "Extract All",
  echo then open the extracted ARCNAVE folder and double-click start.bat there.
  pause
  exit /b 1
)
set PORT=8083
set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE if exist "%~dp0..\node-v24.20.0-win-x64\node.exe" set "NODE=%~dp0..\node-v24.20.0-win-x64\node.exe"
if not defined NODE if exist "%~dp0..\node\node-v24.20.0-win-x64\node.exe" set "NODE=%~dp0..\node\node-v24.20.0-win-x64\node.exe"
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"
if not defined NODE (
  echo Node.js was not found.
  echo Use the ARCNAVE-v0.38.zip made by make-share.bat ^(it has Node inside, in the "node" folder^),
  echo or install Node.js LTS from https://nodejs.org and double-click start.bat again.
  pause
  exit /b 1
)
echo Using Node: %NODE%
echo Starting ARCNAVE on http://localhost:%PORT%   (close this window to stop)
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%/"
"%NODE%" server.js
echo.
echo ARCNAVE stopped. If it said "address already in use", ARCNAVE is already running: open http://localhost:%PORT%/
pause
