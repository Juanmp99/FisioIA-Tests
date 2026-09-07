@echo off
cd /d "%~dp0"
title FisioIA - Asistente de tests

echo.
echo   Arrancando el asistente de tests. No cierres esta ventana mientras lo uses.
echo   El navegador se abrira solo en unos segundos.
echo.

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3200'"
npm start

echo.
echo   El servidor se ha detenido. Puedes cerrar esta ventana.
pause >nul
