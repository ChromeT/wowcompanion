@echo off
git config user.email "chromet@user.com"
git config user.name "ChromeT"
git add .
git commit -m "feat: stabilize playAlarm reference with playAlarmRef to prevent loop clearing"
git push origin main
