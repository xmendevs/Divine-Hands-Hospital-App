@echo off
cd /d "%~dp0"

if not exist "config.bat" goto :noconfig
call "config.bat"

echo Stopping the application...
taskkill /im go-api.exe /f >nul 2>&1

echo Stopping the database...
"%CD%\bin\pgsql\bin\pg_ctl.exe" -D "%CD%\data" -w stop
if errorlevel 1 echo (PostgreSQL was not running, or had already stopped)

echo Done.
pause
goto :eof

:noconfig
echo ERROR: config.bat not found.
pause
