@echo off
rem Removes the native messaging host registration for the current user.
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jobtools.shared" /f
echo Done. Restart Chrome.
pause
