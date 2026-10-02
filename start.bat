@echo off
title Discord Control Center
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js bulunamadi. Node.js 18 veya daha yeni bir surum kur:
    echo https://nodejs.org/
    pause
    exit /b 1
)

if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo .env dosyasi olusturuldu.
    echo Once .env dosyasina Discord bilgilerini yaz, sonra bu dosyayi tekrar calistir.
    pause
    exit /b 0
)

if not exist "node_modules" (
    echo Ilk kurulum yapiliyor...
    call npm.cmd install
    if errorlevel 1 (
        echo Paket kurulumu basarisiz.
        pause
        exit /b 1
    )
)

start "Discord Control Center" http://localhost:3000
echo Bot ve web paneli baslatiliyor...
call npm.cmd start
pause