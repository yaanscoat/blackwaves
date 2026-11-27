#!/usr/bin/env bash
# blackwaves setup (Linux).
#
# Serves https://blackwaveson.top straight from index.mjs: no Caddy, no nginx.
# The certificate comes from Let's Encrypt and renews on its own. The server
# runs as a systemd service in the background, so this script exits when it's
# done and the machine is yours to use as usual. Safe to re-run any time.
#
#   ./setup.sh             install or update, then start
#   ./setup.sh uninstall   stop and remove the service (keeps the certificate)
#
# Options, as environment variables:
#   DOMAIN=blackwaveson.top   domain to serve (its A record must point here)
#   EMAIL=you@example.com     Let's Encrypt expiry notices (optional)
#   AUTO_UPDATE=1             pull origin/main every 2 minutes and restart (0 = off)

set -euo pipefail

DOMAIN="${DOMAIN:-blackwaveson.top}"
EMAIL="${EMAIL:-}"
AUTO_UPDATE="${AUTO_UPDATE:-1}"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
CONF_DIR=/etc/blackwaves
ENV_FILE="$CONF_DIR/blackwaves.env"
TLS_DIR="$CONF_DIR/tls"
ACME_DIR=/var/lib/blackwaves/acme
SERVICE=blackwaves
LOG="/tmp/blackwaves-setup.log"

info()      { printf "\033[1;36m[INFO]\033[0m %s\n" "$1"; }
success()   { printf "\033[1;32m[SUCCESS]\033[0m %s\n" "$1"; }
warn()      { printf "\033[1;33m[WARN]\033[0m %s\n" "$1"; }
error()     { printf "\033[1;31m[ERROR]\033[0m %s\n" "$1" >&2; }
highlight() { printf "\033[1;34m%s\033[0m\n" "$1"; }
separator() { printf "\033[1;37m---------------------------------------------\033[0m\n"; }

# Quiet by default; the full output goes to $LOG and is shown if a step fails.
run() {
  if ! "$@" >>"$LOG" 2>&1; then
    error "Failed: $*"
    tail -n 20 "$LOG" >&2
    error "Full log: $LOG"
    exit 1
  fi
}

USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
if [ "$(id -u)" -eq 0 ]; then SUDO=(); else SUDO=(sudo); fi
# Run as the owner of the repo even when the script itself was started with sudo.
as_user() { if [ "$(id -un)" = "$RUN_USER" ]; then "$@"; else sudo -u "$RUN_USER" -H "$@"; fi; }

[ "$(uname -s)" = "Linux" ] || { error "This script is for Linux."; exit 1; }
command -v systemctl >/dev/null 2>&1 || { error "systemd is required (systemctl not found)."; exit 1; }
: >"$LOG"

if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf >/dev/null 2>&1; then PM=dnf
elif command -v pacman >/dev/null 2>&1; then PM=pacman
else PM=none
fi

APT_UPDATED=0
pkg_install() {
  if [ "$PM" = apt ] && [ "$APT_UPDATED" = 0 ]; then run "${SUDO[@]}" apt-get update -y; APT_UPDATED=1; fi
  case "$PM" in
    apt) run "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf) run "${SUDO[@]}" dnf install -y "$@" ;;
    pacman) run "${SUDO[@]}" pacman -S --noconfirm --needed "$@" ;;
    *) error "Install these yourself, then re-run: $*"; exit 1 ;;
  esac
}

# ---------------------------------------------------------------- uninstall

if [ "${1:-}" = "uninstall" ]; then
  highlight "Removing the blackwaves service"
  "${SUDO[@]}" systemctl disable --now "$SERVICE.service" "$SERVICE-update.timer" >/dev/null 2>&1 || true
  "${SUDO[@]}" rm -f /etc/systemd/system/$SERVICE.service /etc/systemd/system/$SERVICE-update.service /etc/systemd/system/$SERVICE-update.timer
  "${SUDO[@]}" systemctl daemon-reload
  success "Service removed. The certificate and $CONF_DIR were kept (delete them by hand if you want)."
  exit 0
fi

highlight "blackwaves setup -> https://$DOMAIN"
separator

# ---------------------------------------------------------------- Node.js

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]
}

info "Checking Node.js (22 or newer)..."
if node_ok; then
  success "Node.js $(node -v) is installed."
else
  info "Installing Node.js 22..."
  case "$PM" in
    apt)
      pkg_install ca-certificates curl gnupg
      curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
      run "${SUDO[@]}" bash /tmp/nodesource_setup.sh
      APT_UPDATED=1  # the NodeSource script already refreshed the package lists
      pkg_install nodejs
      ;;
    dnf)
      curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
      run "${SUDO[@]}" bash /tmp/nodesource_setup.sh
      pkg_install nodejs
      ;;
    *) pkg_install nodejs npm ;;
  esac
  hash -r
  node_ok || { error "Node.js 22+ is still missing. Install it, then re-run."; exit 1; }
  success "Node.js $(node -v) installed."
fi
NODE_BIN="$(command -v node)"
separator

info "Installing dependencies..."
(cd "$APP_DIR" && run as_user npm install --omit=dev --no-audit --no-fund)
success "Dependencies installed."
separator

# ---------------------------------------------------------------- free ports 80/443

info "Making room on ports 80 and 443..."
"${SUDO[@]}" systemctl stop "$SERVICE.service" >/dev/null 2>&1 || true
# Older versions of this script used Caddy, PM2 and a background git loop.
if systemctl is-active --quiet caddy 2>/dev/null || systemctl is-enabled --quiet caddy 2>/dev/null; then
  "${SUDO[@]}" systemctl disable --now caddy >/dev/null 2>&1 || true
  warn "Stopped and disabled Caddy (blackwaves serves HTTPS itself now)."
fi
if command -v pm2 >/dev/null 2>&1 && as_user pm2 describe index.mjs >/dev/null 2>&1; then
  as_user pm2 delete index.mjs >/dev/null 2>&1 || true
  as_user pm2 save --force >/dev/null 2>&1 || true
  warn "Removed the old PM2 process (systemd runs blackwaves now)."
fi
pkill -u "$RUN_USER" -f 'pm2 restart index.mjs' >/dev/null 2>&1 || true

busy="$("${SUDO[@]}" ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
if [ -n "$busy" ]; then
  error "Something else is using port 80 or 443:"
  printf "%s\n" "$busy" >&2
  error "Stop it (for example: sudo systemctl disable --now nginx), then re-run."
  exit 1
fi
success "Ports 80 and 443 are free."
separator

# ---------------------------------------------------------------- service

info "Writing the systemd service..."
"${SUDO[@]}" mkdir -p "$CONF_DIR" "$TLS_DIR" "$ACME_DIR"
"${SUDO[@]}" chown "$RUN_USER" "$TLS_DIR" "$ACME_DIR"
"${SUDO[@]}" chmod 700 "$TLS_DIR"

write_env() { # $1 = tls | http
  {
    echo "# Written by setup.sh. Re-run setup.sh instead of editing by hand."
    echo "NODE_ENV=production"
    echo "DOMAIN=$DOMAIN"
    echo "ACME_DIR=$ACME_DIR"
    if [ "$1" = tls ]; then
      echo "PORT=443"
      echo "HTTP_PORT=80"
      echo "TLS_CERT=$TLS_DIR/fullchain.pem"
      echo "TLS_KEY=$TLS_DIR/privkey.pem"
    else
      echo "PORT=80"
    fi
  } | "${SUDO[@]}" tee "$ENV_FILE" >/dev/null
}

"${SUDO[@]}" tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=blackwaves web proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN index.mjs
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=3
# Lets the server bind ports 80/443 without running as root.
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# Start on plain HTTP first so Let's Encrypt can reach the challenge folder.
[ -s "$TLS_DIR/fullchain.pem" ] && [ -s "$TLS_DIR/privkey.pem" ] && write_env tls || write_env http
run "${SUDO[@]}" systemctl daemon-reload
run "${SUDO[@]}" systemctl enable --now "$SERVICE.service"
success "Service installed and started."
separator

info "Opening the firewall..."
if command -v ufw >/dev/null 2>&1 && "${SUDO[@]}" ufw status 2>/dev/null | grep -q "Status: active"; then
  run "${SUDO[@]}" ufw allow 80/tcp
  run "${SUDO[@]}" ufw allow 443/tcp
  success "ufw: allowed 80 and 443."
elif command -v firewall-cmd >/dev/null 2>&1 && "${SUDO[@]}" firewall-cmd --state >/dev/null 2>&1; then
  run "${SUDO[@]}" firewall-cmd --permanent --add-service=http --add-service=https
  run "${SUDO[@]}" firewall-cmd --reload
  success "firewalld: allowed http and https."
else
  success "No active firewall found. (Cloud servers may still need 80/443 opened in the provider's panel.)"
fi
separator

# ---------------------------------------------------------------- certificate

info "Checking DNS for $DOMAIN..."
PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
DNS_IPS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
DOMAINS=(-d "$DOMAIN")
if getent ahostsv4 "www.$DOMAIN" >/dev/null 2>&1; then DOMAINS+=(-d "www.$DOMAIN"); fi

HAVE_CERT=0
if [ -z "$DNS_IPS" ]; then
  warn "$DOMAIN has no A record yet."
  warn "In your DNS panel (Spaceship), add:  A   @   ${PUBLIC_IP:-<your server IP>}"
  warn "Then run ./setup.sh again to get the HTTPS certificate."
else
  if [ -n "$PUBLIC_IP" ] && ! grep -qw "$PUBLIC_IP" <<<"$DNS_IPS"; then
    warn "$DOMAIN points to $DNS_IPS but this server is $PUBLIC_IP. Trying anyway..."
  else
    success "$DOMAIN points here."
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    info "Installing certbot..."
    pkg_install certbot
  fi

  # Copies the certificate where the service user can read it, then reloads
  # the server in place. certbot runs this after every renewal.
  "${SUDO[@]}" tee "$CONF_DIR/deploy-hook.sh" >/dev/null <<EOF
#!/bin/sh
set -e
install -o "$RUN_USER" -m 600 "\$RENEWED_LINEAGE/fullchain.pem" "$TLS_DIR/fullchain.pem"
install -o "$RUN_USER" -m 600 "\$RENEWED_LINEAGE/privkey.pem" "$TLS_DIR/privkey.pem"
systemctl reload $SERVICE.service >/dev/null 2>&1 || true
EOF
  "${SUDO[@]}" chmod 755 "$CONF_DIR/deploy-hook.sh"

  info "Requesting a Let's Encrypt certificate..."
  if [ -n "$EMAIL" ]; then ACCOUNT=(--email "$EMAIL"); else ACCOUNT=(--register-unsafely-without-email); fi
  if "${SUDO[@]}" certbot certonly --webroot -w "$ACME_DIR" "${DOMAINS[@]}" --cert-name "$DOMAIN" \
      --non-interactive --agree-tos --keep-until-expiring "${ACCOUNT[@]}" \
      --deploy-hook "$CONF_DIR/deploy-hook.sh" >>"$LOG" 2>&1; then
    # Also covers a re-run where the existing certificate wasn't due for renewal.
    run "${SUDO[@]}" env RENEWED_LINEAGE="/etc/letsencrypt/live/$DOMAIN" "$CONF_DIR/deploy-hook.sh"
    HAVE_CERT=1
    success "Certificate ready (renews automatically)."
  else
    tail -n 15 "$LOG" >&2
    warn "Couldn't get a certificate. The site is up on plain http://$DOMAIN for now."
    warn "Fix the DNS/firewall issue above, then run ./setup.sh again."
  fi
fi

if [ "$HAVE_CERT" = 1 ]; then
  write_env tls
  run "${SUDO[@]}" systemctl restart "$SERVICE.service"
  # Debian/Ubuntu enable certbot.timer on install; Fedora ships it disabled.
  "${SUDO[@]}" systemctl enable --now certbot.timer >/dev/null 2>&1 \
    || "${SUDO[@]}" systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || true
  success "HTTPS is on. http:// redirects to https://$DOMAIN."
fi
separator

# ---------------------------------------------------------------- auto-update

if [ "$AUTO_UPDATE" = 1 ] && git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  info "Setting up auto-update (every 2 minutes)..."
  "${SUDO[@]}" tee "$CONF_DIR/update.sh" >/dev/null <<EOF
#!/bin/sh
# Pulls origin/main; reinstalls dependencies only when package.json changed.
set -e
cd "$APP_DIR"
u() { runuser -u "$RUN_USER" -- env HOME="$USER_HOME" "\$@"; }
u git fetch -q origin main
[ "\$(u git rev-parse HEAD)" = "\$(u git rev-parse origin/main)" ] && exit 0
before="\$(u git rev-parse HEAD:package.json)"
u git pull -q --ff-only origin main
[ "\$before" = "\$(u git rev-parse HEAD:package.json)" ] || u npm install --omit=dev --no-audit --no-fund
systemctl restart $SERVICE.service
EOF
  "${SUDO[@]}" chmod 755 "$CONF_DIR/update.sh"
  "${SUDO[@]}" tee /etc/systemd/system/$SERVICE-update.service >/dev/null <<EOF
[Unit]
Description=Update blackwaves from git

[Service]
Type=oneshot
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$CONF_DIR/update.sh
EOF
  "${SUDO[@]}" tee /etc/systemd/system/$SERVICE-update.timer >/dev/null <<EOF
[Unit]
Description=Check for blackwaves updates

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF
  run "${SUDO[@]}" systemctl daemon-reload
  run "${SUDO[@]}" systemctl enable --now "$SERVICE-update.timer"
  success "Auto-update on."
else
  "${SUDO[@]}" systemctl disable --now "$SERVICE-update.timer" >/dev/null 2>&1 || true
  info "Auto-update off."
fi
separator

sleep 2
if systemctl is-active --quiet "$SERVICE.service"; then
  if [ "$HAVE_CERT" = 1 ]; then success "blackwaves is live at https://$DOMAIN"
  else success "blackwaves is running on http://${PUBLIC_IP:-<server-ip>} (HTTPS pending, see above)"
  fi
else
  error "The service didn't stay up. Last log lines:"
  "${SUDO[@]}" journalctl -u "$SERVICE" -n 20 --no-pager >&2 || true
  exit 1
fi
separator
cat <<EOF
It runs in the background and starts on boot. Useful commands:
  systemctl status $SERVICE           is it running?
  journalctl -u $SERVICE -f           live logs (Ctrl+C to stop watching)
  sudo systemctl restart $SERVICE     restart
  sudo systemctl stop $SERVICE        stop until next boot
  ./setup.sh uninstall                remove the service
EOF
