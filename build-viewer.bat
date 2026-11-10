@echo off
rem The viewer-only installer: opens NIfTI files and shows headers; everything
rem else (NumPy, SciPy, LQTpy, the template, atlases) installs from the module store.
rem Same steps as build-minimal.bat, with assemble-bundle -Viewer.
REM Needs internet + a full Python 3.11 (py -3.11) + Node/yarn the first time;
REM re-runs reuse tools\build\downloads\.
cd /d "%~dp0"

echo === 1/2: Assembling the offline bundle (viewer-only: server + module store, no numpy) ===
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\build\assemble-bundle.ps1" -Viewer
if errorlevel 1 goto :error

REM electron-builder's exe tool unpacks with macOS symbolic links, which
REM Windows refuses without Developer Mode - so put it in place ourselves
REM first (tools\build\ensure-wincodesign.ps1 explains).
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\build\ensure-wincodesign.ps1"
if errorlevel 1 goto :error

echo.
echo === 2/2: Building the frontend and packaging the installer ===
cd frontend
call yarn dist:win:viewer
if errorlevel 1 goto :error

echo.
echo Done. Installer is in MRLatte-build\electron\
pause
exit /b 0

:error
echo.
echo Build failed - see the errors above.
pause
exit /b 1
