"""Run over SSH with piped stdin; never echo or pass the API key in argv."""

import os
import re
import sys

key = sys.stdin.readline().strip()
if not re.fullmatch(r"sk-[A-Za-z0-9_-]{16,160}", key):
    raise SystemExit("Invalid key format; configuration not written.")
path = "/etc/microclimate-aic.env"
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    os.write(fd, ("AIC_DEEPSEEK_API_KEY=" + key + "\n").encode())
finally:
    os.close(fd)
print("Private AIC configuration created with mode 0600.")
