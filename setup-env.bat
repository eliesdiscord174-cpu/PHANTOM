@echo off
REM Ce script cree ton fichier .env pour toi.
REM Il te demande ton Client ID / Cle secrete Discord et tes identifiants
REM Supabase, puis ecrit directement le fichier .env dans ce dossier.
REM Rien n'est envoye nulle part : tout reste en local sur ta machine.

echo ============================================
echo   Configuration PHANTOM - Discord + Supabase
echo ============================================
echo.

set /p CLIENT_ID="Colle ton DISCORD CLIENT ID puis Entree : "
set /p CLIENT_SECRET="Colle ta DISCORD CLIENT SECRET puis Entree : "
set /p SUPA_URL="Colle ton SUPABASE URL (Project Settings ^> API) puis Entree : "
set /p SUPA_KEY="Colle ta SUPABASE SERVICE ROLE KEY (Project Settings ^> API) puis Entree : "

(
echo DISCORD_CLIENT_ID=%CLIENT_ID%
echo DISCORD_CLIENT_SECRET=%CLIENT_SECRET%
echo DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
echo ADMIN_DISCORD_IDS=1534876283421462549
echo.
echo SUPABASE_URL=%SUPA_URL%
echo SUPABASE_SERVICE_ROLE_KEY=%SUPA_KEY%
echo.
echo SESSION_SECRET=phantom-session-secret-%RANDOM%%RANDOM%
echo.
echo PORT=3000
) > .env

echo.
echo Fichier .env cree avec succes dans ce dossier !
echo N'oublie pas d'avoir execute supabase-schema.sql dans ton projet Supabase.
echo Tu peux maintenant lancer : npm install puis npm start
echo.
pause
