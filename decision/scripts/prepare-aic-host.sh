#!/usr/bin/env bash
set -euo pipefail
if [[ ! -e /etc/nginx/sites-available/aic ]]; then
  python3 - <<'PY'
from pathlib import Path
Path('/etc/nginx/sites-available/aic').write_text('''server {
    listen 80;
    server_name aic.nogamenolife.cn;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 503; }
}
''')
PY
  mkdir -p /var/www/certbot/.well-known/acme-challenge
  ln -s /etc/nginx/sites-available/aic /etc/nginx/sites-enabled/aic
  nginx -t
  systemctl reload nginx
fi
if [[ ! -f /etc/letsencrypt/live/aic.nogamenolife.cn/fullchain.pem ]]; then
  certbot certonly --webroot -w /var/www/certbot -d aic.nogamenolife.cn --non-interactive --agree-tos --register-unsafely-without-email
fi
openssl x509 -in /etc/letsencrypt/live/aic.nogamenolife.cn/fullchain.pem -noout -subject -dates
