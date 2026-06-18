@echo off
git config user.email "chromet@user.com"
git config user.name "ChromeT"
git add .
git commit -m "feat: auto-reset trackers on date change and fix alarm autoplay"
git push origin main
