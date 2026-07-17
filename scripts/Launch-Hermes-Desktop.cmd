@echo off
setlocal

REM Launch the source-backed personal setup, not the packaged executable
REM directly. The direct executable cannot see this repo's external venv.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0hermes-personal.ps1" desktop --skip-build --ignore-existing
