@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Divine Hands Hospital - Server

echo.
echo ==================================================
echo   Divine Hands Hospital  -  main PC server
echo ==================================================
echo.

if not exist "config.bat" goto :noconfig
call "config.bat"

set "BIN=%~dp0bin"
set "PGDATA=%~dp0data"
set "PGCTL=%BIN%\pgsql\bin\pg_ctl.exe"
set "INITDB=%BIN%\pgsql\bin\initdb.exe"
set "CREATEDB=%BIN%\pgsql\bin\createdb.exe"
set "PSQL=%BIN%\pgsql\bin\psql.exe"
set "PGDUMP=%BIN%\pgsql\bin\pg_dump.exe"

if not exist "%PGCTL%" goto :nopgsql
if not exist "%BIN%\migrate.exe" goto :nobins
if not exist "%BIN%\go-api.exe" goto :nobins
if not exist "%BIN%\seed.exe" goto :nobins

REM ---------------------------------------------------------------
REM 1. First run only: create the database cluster
REM ---------------------------------------------------------------
if exist "%PGDATA%\PG_VERSION" goto :dbinitdone
echo [1/4] First run - creating the database cluster...
> "%~dp0.pgpass.txt" echo %PGPASSWORD%
"%INITDB%" -D "%PGDATA%" -U %PGUSER% --auth=scram-sha-256 --pwfile="%~dp0.pgpass.txt" --encoding=UTF8
if errorlevel 1 goto :fail
del "%~dp0.pgpass.txt" 2>nul
echo.
:dbinitdone

REM ---------------------------------------------------------------
REM 2. Start PostgreSQL (binds to 127.0.0.1 only)
REM ---------------------------------------------------------------
echo [2/4] Starting the database...
"%PGCTL%" -D "%PGDATA%" -l "%PGDATA%\postgres.log" -o "-p %PGPORT%" -w start
if errorlevel 1 (
  echo   (PostgreSQL may already be running - continuing)
)

REM Create the 'hims' database if it does not exist yet
"%PSQL%" -h 127.0.0.1 -p %PGPORT% -U %PGUSER% -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='hims'" | find "1" >nul
if errorlevel 1 (
  echo   Creating database 'hims'...
  "%CREATEDB%" -h 127.0.0.1 -p %PGPORT% -U %PGUSER% hims
  if errorlevel 1 goto :fail
)
echo.

REM ---------------------------------------------------------------
REM 3. Apply migrations and seed the first admin account
REM ---------------------------------------------------------------
echo [3/4] Applying database migrations...
set "DATABASE_URL=postgres://%PGUSER%:%PGPASSWORD%@127.0.0.1:%PGPORT%/hims?sslmode=disable"
"%BIN%\migrate.exe" -command up -dir "%~dp0migrations"
if errorlevel 1 goto :fail

echo   Creating the first admin account (skipped if it already exists)...
"%BIN%\seed.exe"
if errorlevel 1 goto :fail
echo.

REM ---------------------------------------------------------------
REM 4. Start the application (this is what the other PCs connect to)
REM ---------------------------------------------------------------
echo [4/4] Starting the application...
echo.
echo   Other PCs connect to:  http://%COMPUTERNAME%:%APP_PORT%
echo   (or use this PC's IP address instead of the computer name)
echo.
echo   Keep this window open. Close it to stop the server.
echo ==================================================
echo.

set "HOST=%APP_HOST%"
set "PORT=%APP_PORT%"
set "REDIS_ENABLED=false"
set "MFA_ENCRYPTION_KEY=%MFA_ENCRYPTION_KEY%"
set "BACKUP_ENABLED=%BACKUP_ENABLED%"
set "BACKUP_ENCRYPTION_KEY=%BACKUP_ENCRYPTION_KEY%"
set "BACKUP_LOCAL_DIR=%BACKUP_LOCAL_DIR%"
set "BACKUP_PG_DUMP_PATH=%PGDUMP%"
set "BACKUP_RETENTION_DAILY=%BACKUP_RETENTION_DAILY%"
set "BACKUP_RETENTION_WEEKLY=%BACKUP_RETENTION_WEEKLY%"
set "BACKUP_RETENTION_MONTHLY=%BACKUP_RETENTION_MONTHLY%"
set "BACKUP_LOCAL_INTERVAL=%BACKUP_LOCAL_INTERVAL%"
set "BACKUP_VERIFY_INTERVAL=%BACKUP_VERIFY_INTERVAL%"

"%BIN%\go-api.exe"

echo.
echo Application stopped. Stopping the database...
"%PGCTL%" -D "%PGDATA%" -w stop
echo Done.
goto :eof

:noconfig
echo ERROR: config.bat not found.
echo Copy config.example.bat to config.bat, edit it, then run Start.bat again.
pause
exit /b 1

:nopgsql
echo ERROR: PostgreSQL binaries not found under bin\pgsql.
echo Build the bundle with build-bundle.sh (see infra\windows-bundle\README.md).
pause
exit /b 1

:nobins
echo ERROR: go-api.exe / migrate.exe / seed.exe not found under bin\.
echo Build the bundle with build-bundle.sh (see infra\windows-bundle\README.md).
pause
exit /b 1

:fail
echo.
echo Startup failed - see the messages above.
echo Database log: data\postgres.log
pause
exit /b 1
