@echo off
title ARCNAVE: make the share zip
rem Makes ONE file to share: ..\ARCNAVE-v0.38.zip  (the app, the saved demo images, and the portable Node, so the other
rem laptop needs nothing installed). The big local "cache" folder is left out; it is rebuilt by itself.
set "SRC=%~dp0"
set "OUT=%~dp0..\ARCNAVE-SHARE\ARCNAVE"
set "ZIP=%~dp0..\ARCNAVE-v0.38.zip"
echo Copying the app (without cache)...
robocopy "%SRC%." "%OUT%" /E /XD cache node_modules .git debug-cutouts /XF *.tmp /NFL /NDL /NJH /NJS /NP >nul
if exist "%SRC%..\node-v24.20.0-win-x64\node.exe" (
  echo Copying portable Node...
  robocopy "%SRC%..\node-v24.20.0-win-x64" "%OUT%\node" node.exe LICENSE /NFL /NDL /NJH /NJS /NP >nul
)
echo Zipping (a few minutes, about 300 MB)...
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 ( echo Zip failed. & pause & exit /b 1 )
echo.
echo Done: %ZIP%
echo Share this one file. On the other laptop: unzip, open the ARCNAVE folder, double-click start.bat
pause
