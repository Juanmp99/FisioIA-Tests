@echo off
cd /d "%~dp0"
title FisioIA - Asistente de tests

echo.
echo   Arrancando el asistente de tests. No cierres esta ventana mientras lo uses.
echo   El navegador se abrira solo en unos segundos.
echo.

rem En local se salta la puerta del correo: el alta por correo es para la web
rem publicada, no para trabajar aqui.
set ACCESO_LIBRE=1

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3200/app'"
npm start

echo.
echo   El servidor se ha detenido. Puedes cerrar esta ventana.
pause >nul
