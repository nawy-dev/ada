#!/usr/bin/env bash
# Runs inside an Android emulator: installs the APK, drives the real app and asks the phone whether
# reminders were scheduled and a test notification was shown. Everything useful is printed to the
# job log (read it with `gh run view <id> --log | grep "\[e2e\]"`).
set -u
PKG=ada.nawy.app
APK=${1:?apk path}
OUT=${2:-emulator-out}
MODE=${3:-e2e} # e2e = reminder checks; screenshots = Google Play screenshots
mkdir -p "$OUT"

adb install -r "$APK" || exit 1
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
if [ "$MODE" = screenshots ]; then
  # A common phone shape (1080x1920 is 16:9, which Play accepts). Changing the density restarts
  # System UI, so give it time before the status bar is cleaned up below.
  adb shell wm size 1080x1920
  adb shell wm density 420
  sleep 10
fi
adb logcat -c
adb shell am start -n $PKG/.MainActivity
sleep 12
PID=$(adb shell pidof $PKG | tr -d '\r')
echo "app pid: $PID"
adb forward tcp:9222 localabstract:webview_devtools_remote_"$PID"

if [ "$MODE" = screenshots ]; then
  # Clean status bar (fixed clock, full battery, no notification icons) for the store pictures.
  adb shell settings put global sysui_demo_allowed 1
  demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" | grep -o "result=[0-9-]*"; }
  demo enter
  demo clock -e hhmm 0941
  demo battery -e level 100 -e plugged false
  demo network -e wifi show -e level 4
  demo network -e mobile show -e datatype none -e level 4
  demo notifications -e visible false
  sleep 2
  node tools/android/screenshots.mjs "$OUT"
  exit $?
fi
node tools/android/emulator_test.mjs "$OUT"
STATUS=$?

echo "===== alarms for the app ====="
adb shell dumpsys alarm | grep -B1 -A6 "$PKG" | head -80
echo "===== notifications for the app ====="
adb shell dumpsys notification --noredact | grep -A25 "pkg=$PKG" | head -120
echo "===== logcat (app, notifications, alarms) ====="
adb logcat -d | grep -iE "$PKG|LocalNotif|Capacitor|AlarmManager|NotificationService" | tail -80
adb exec-out screencap -p > "$OUT/final.png"
adb logcat -d > "$OUT/logcat.txt"
adb shell dumpsys notification --noredact > "$OUT/notifications.txt"
exit $STATUS
