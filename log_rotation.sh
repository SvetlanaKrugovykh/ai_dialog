#!/bin/bash

# Rotate logs for two projects managed by PM2: Zammad-Assist and ai_dialog (ai-dialog)
# Usage: ./log_rotation.sh [YYYY-MM-DD]

# Allow passing a date (useful for testing), otherwise use yesterday's date
if [ -n "$1" ]; then
  TARGET_DATE="$1"
else
  # GNU date used here; on macOS use: date -v -1d +%Y-%m-%d
  TARGET_DATE=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v -1d +%Y-%m-%d)
fi

echo "Rotating logs for date: $TARGET_DATE"

# Configuration for projects
# Each entry: "<human-name>|<error-log-path>|<out-log-path>|<pm2-process-name>"
projects=( \
  "Zammad-Assist|/root/.pm2/logs/Zammad-Assist-error.log|/root/.pm2/logs/Zammad-Assist-out.log|Zammad-Assist" \
  "ai_dialog|/intelligence/ai_dialog/ai_dialog-error.log|/intelligence/ai_dialog/ai_dialog-out.log|ai-dialog" \
)

for entry in "${projects[@]}"; do
  IFS='|' read -r projName errLog outLog pm2Name <<< "$entry"

  # Derive old logs directory based on logs directory
  logDir=$(dirname "$errLog")
  oldLogsDir="$logDir/old_logs"

  echo "Processing project: $projName"
  echo "  error log: $errLog"
  echo "  out log:   $outLog"
  echo "  pm2 name:  $pm2Name"

  mkdir -p "$oldLogsDir"

  # Move error log if not empty
  if [ -s "$errLog" ]; then
    mv "$errLog" "$oldLogsDir/${projName}-error_${TARGET_DATE}.log"
    echo "  Moved error log to $oldLogsDir/${projName}-error_${TARGET_DATE}.log"
  else
    echo "  No error log to rotate"
  fi

  # Move out log if not empty
  if [ -s "$outLog" ]; then
    mv "$outLog" "$oldLogsDir/${projName}-out_${TARGET_DATE}.log"
    echo "  Moved out log to $oldLogsDir/${projName}-out_${TARGET_DATE}.log"
  else
    echo "  No out log to rotate"
  fi

  # Restart pm2 process if process name provided
  if [ -n "$pm2Name" ]; then
    echo "  Restarting PM2 process: $pm2Name"
    pm2 restart "$pm2Name" || echo "  Failed to restart PM2 process $pm2Name"
  fi

  echo ""

done

exit 0
