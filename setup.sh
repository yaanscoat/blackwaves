#!/bin/bash

info() {
  printf "\033[1;36m[INFO]\033[0m %s\n" "$1"
}

success() {
  printf "\033[1;32m[SUCCESS]\033[0m %s\n" "$1"
}

error() {
  printf "\033[1;31m[ERROR]\033[0m %s\n" "$1"
}

highlight() {
  printf "\033[1;34m%s\033[0m\n" "$1"
}

separator() {
  printf "\033[1;37m---------------------------------------------\033[0m\n"
}

clear

highlight "██████╗ ██╗      █████╗  ██████╗██╗  ██╗██╗    ██╗ █████╗ ██╗   ██╗███████╗███████╗"
highlight "██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝██║    ██║██╔══██╗██║   ██║██╔════╝██╔════╝"
highlight "██████╔╝██║     ███████║██║     █████╔╝ ██║ █╗ ██║███████║██║   ██║█████╗  ███████╗"
highlight "██╔══██╗██║     ██╔══██║██║     ██╔═██╗ ██║███╗██║██╔══██║╚██╗ ██╔╝██╔══╝  ╚════██║"
highlight "██████╔╝███████╗██║  ██║╚██████╗██║  ██╗╚███╔███╔╝██║  ██║ ╚████╔╝ ███████╗███████║██╗"
highlight "╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚══════╝╚═╝"

separator
info "Starting the setup process..."
separator

info "Checking if Node.js and npm are installed..."
if ! dpkg-query -l | grep -q nodejs; then
  info "Node.js not found. Installing..."
  sudo apt update -y > /dev/null 2>&1
  sudo apt install -y nodejs npm > /dev/null 2>&1
  success "Node.js and npm installed successfully."
else
  success "Node.js and npm are already installed."
fi
separator

info "Checking if Caddy is installed..."
if ! dpkg-query -l | grep -q caddy; then
  info "Caddy not found. Installing..."
  sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https > /dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg > /dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/deb.debian.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  sudo apt update -y > /dev/null 2>&1
  sudo apt install -y caddy > /dev/null 2>&1
  success "Caddy installed successfully."
else
  success "Caddy is already installed."
fi
separator

info "Creating Caddyfile..."
cat <<EOF | sudo tee /etc/caddy/Caddyfile > /dev/null
:443 {
    tls {
        on_demand
    }

    reverse_proxy http://localhost:8000
    encode gzip zstd

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "ALLOWALL"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "no-referrer"
    }
}
EOF
separator

info "Testing Caddy configuration..."
sudo caddy fmt /etc/caddy/Caddyfile > /dev/null 2>&1
if [ $? -eq 0 ]; then
  success "Caddyfile is valid."
else
  error "Caddyfile test failed. Exiting."
  exit 1
fi

info "Starting Caddy..."
if ! sudo systemctl restart caddy > /dev/null 2>&1; then
  error "Failed to start Caddy."
  exit 1
fi
success "Caddy started."
separator

info "Checking if PM2 is installed..."
PM2_PATH=$(which pm2 2>/dev/null)
if [ "$PM2_PATH" = "/usr/local/bin/pm2" ]; then
  success "PM2 is already installed."
else
  info "PM2 not found or not in the expected path. Installing..."
  sudo npm install -g pm2 > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    success "PM2 installed successfully."
  else
    error "Failed to install PM2."
    exit 1
  fi
fi
separator

info "Installing dependencies..."
npm install > /dev/null 2>&1
success "Dependencies installed."
separator

info "Starting the server with PM2..."
pm2 start index.mjs --name blackwaves > /dev/null 2>&1
pm2 save > /dev/null 2>&1
success "Server started and saved with PM2."
separator

info "Setting up Git auto-update..."
nohup bash -c "
while true; do
    git fetch origin
    LOCAL=\$(git rev-parse main)
    REMOTE=\$(git rev-parse origin/main)

    if [ \$LOCAL != \$REMOTE ]; then
        git pull origin main > /dev/null 2>&1
        pm2 restart blackwaves > /dev/null 2>&1
        pm2 save > /dev/null 2>&1
    fi
    sleep 1
done
" > /dev/null 2>&1 &
success "Git auto-update setup completed."
separator

success "Setup completed."
separator