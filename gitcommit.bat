@echo off
git config user.email "chromet@user.com"
git config user.name "ChromeT"
git add .
git commit -m "feat: add live countdowns for hourly slot unlock and daily reset"
git push origin main
