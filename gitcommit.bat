@echo off
git config user.email "chromet@user.com"
git config user.name "ChromeT"
git add .
git commit -m "chore: remove visual debug logs panel"
git push origin main
