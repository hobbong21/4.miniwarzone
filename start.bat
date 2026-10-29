@echo off
chcp 65001 >nul
rem 미니워존 서버 실행 (Windows) - 더블클릭하면 서버를 켜고 브라우저로 게임을 엽니다
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.5 이상이 필요합니다: https://nodejs.org & pause & exit /b 1)
if "%PORT%"=="" set PORT=8080
start "" http://localhost:%PORT%
node server\server.js
pause
