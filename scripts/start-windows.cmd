@echo off
setlocal
pushd "%~dp0.."
if errorlevel 1 exit /b 1
if exist "Lumina-Live.exe" (
  "Lumina-Live.exe" %*
  popd
  exit /b
)
rem Prefer the portable release, which needs neither Node nor npm installed.
for %%F in ("release\Lumina-Live-*-x64-portable.exe") do if exist "%%~fF" (
  "%%~fF" %*
  popd
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo Run the EXE from release, or install Node.js to launch from source.
  popd
  exit /b 1
)
if not exist "node_modules\electron\cli.js" (
  echo Dependencies are missing. Run npm ci before starting Lumina Live.
  popd
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 (
    popd
    exit /b 1
  )
)
node "node_modules\electron\cli.js" . %*
set "lumina_exit=%errorlevel%"
popd
exit /b %lumina_exit%
