#!/bin/bash
# Start TrustRail FastAPI ML service.
# This script is invoked from the parent bash. We use setsid + nohup to fully
# detach from the controlling terminal so the server survives shell exit.
set -e

cd /home/z/my-project/trustrail-ml

# Kill any prior instance on this port
pkill -f "trustrail-ml/main.py" 2>/dev/null || true
sleep 1

# Start with setsid so it survives parent shell exit
LOG=/tmp/trustrail-ml.log
setsid bash -c "exec python3 main.py > $LOG 2>&1" < /dev/null &
disown
echo "TrustRail ML service starting in background, log at $LOG"

# Wait for it to come up (max 30s)
for i in $(seq 1 30); do
  if curl -s http://localhost:8001/health > /dev/null 2>&1; then
    echo "Service is up after ${i}s"
    curl -s http://localhost:8001/health
    exit 0
  fi
  sleep 1
done

echo "ERROR: service did not start in 30s"
echo "--- last 30 log lines ---"
tail -30 $LOG
exit 1
