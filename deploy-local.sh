#!/bin/bash

# Local Build + Remote Deploy Script
# Builds on your fast local machine, then deploys to a fresh server
# Usage: ./deploy-local.sh root@your-server.com

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check arguments
if [ -z "$1" ]; then
    print_error "Usage: ./deploy-local.sh root@your-server.com"
    exit 1
fi

SERVER="$1"
APP_DIR="/var/www/eigo-email"

print_status "🚀 Starting local build + remote deployment to $SERVER"

# Step 1: Build locally
print_status "📦 Building React frontend locally (fast!)..."
if [ ! -f "package.json" ]; then
    print_error "Must run from project root directory"
    exit 1
fi

# Install dependencies locally if needed
if [ ! -d "node_modules" ]; then
    print_status "Installing root dependencies..."
    npm install
fi

# Build React frontend locally
print_status "Building frontend..."
cd react-ui
if [ ! -d "node_modules" ]; then
    print_status "Installing React dependencies..."
    npm install
fi
npm run build
cd ..
print_success "Frontend built locally!"

# Step 2: Create deployment package
print_status "📦 Creating deployment package..."
TEMP_DIR=$(mktemp -d)
rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'react-ui/node_modules' . "$TEMP_DIR/"

# Copy local .env if it exists
if [ -f ".env" ]; then
    print_status "📋 Including local .env file..."
    cp .env "$TEMP_DIR/.env"
    print_success "Local .env file included"
else
    print_warning "No local .env file found - server will use .env.example"
fi

print_success "Package created at $TEMP_DIR"

# Step 3: Deploy to server
print_status "🌐 Deploying to server $SERVER..."

# Check SSH connection
if ! ssh -o ConnectTimeout=5 "$SERVER" "echo 'SSH connection successful'" > /dev/null 2>&1; then
    print_error "Cannot connect to $SERVER via SSH"
    exit 1
fi

print_success "SSH connection established"

# Step 4: Setup server and copy files
print_status "📤 Copying files to server..."
ssh "$SERVER" "sudo mkdir -p $APP_DIR && sudo chown -R \$(whoami):\$(whoami) $APP_DIR"
rsync -avz --delete "$TEMP_DIR/" "$SERVER:$APP_DIR/"
print_success "Files copied to server"

# Clean up temp directory
rm -rf "$TEMP_DIR"

# Step 5: Run server setup
print_status "🔧 Setting up server (installing Node.js, PM2, Nginx, SSL)..."
ssh "$SERVER" << 'ENDSSH'
set -e

# Colors for remote
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'
print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

cd /var/www/eigo-email

# Check if .env exists (from local copy)
if [ ! -f ".env" ]; then
    print_warning "No .env found, creating from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_warning "⚠️  Please edit /var/www/eigo-email/.env with your API keys!"
    fi
else
    print_success "Using .env file from local machine"
fi

# Install Node.js if missing
if ! command -v node &> /dev/null; then
    print_status "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    print_success "Node.js installed"
fi

# Install PM2 if missing
if ! command -v pm2 &> /dev/null; then
    print_status "Installing PM2..."
    sudo npm install -g pm2
    print_success "PM2 installed"
fi

# Install production dependencies only
print_status "Installing production dependencies..."
npm ci --production || npm install --production

# Setup Nginx if not exists
if ! command -v nginx &> /dev/null; then
    print_status "Installing Nginx..."
    sudo apt-get update
    sudo apt-get install -y nginx
    sudo systemctl enable nginx
    sudo systemctl start nginx
    print_success "Nginx installed"
fi

# Configure Nginx
print_status "Configuring Nginx..."
sudo tee /etc/nginx/sites-available/eigo-email > /dev/null << 'EOF'
server {
    listen 80;
    server_name eigo.email www.eigo.email _;
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/eigo-email /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
print_success "Nginx configured"

# Setup firewall
print_status "Configuring firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 22
    sudo ufw allow 80
    sudo ufw allow 443
    sudo ufw --force enable
    print_success "Firewall configured"
fi

# Start PM2 services
print_status "Starting PM2 services..."
pm2 delete all 2>/dev/null || true
pm2 start server.js --name "language-app" --watch --max-memory-restart 500M
pm2 start scripts/sendDaily.js --name "daily-sentence-mailer" --cron "0 9 * * *" --no-autorestart
pm2 save
pm2 startup systemd -u $(whoami) --hp $HOME | grep "sudo" | bash || true
print_success "PM2 services started"

# Setup SSL with Let's Encrypt (if certbot available)
if command -v certbot &> /dev/null; then
    print_status "Setting up SSL certificates..."
    sudo certbot certonly --standalone -d eigo.email -d www.eigo.email --non-interactive --agree-tos --email admin@eigo.email 2>/dev/null && {
        sudo tee /etc/nginx/sites-available/eigo-email > /dev/null << 'SSLEOF'
server {
    listen 80;
    server_name eigo.email www.eigo.email _;
    return 301 https://eigo.email$request_uri;
}

server {
    listen 443 ssl http2;
    server_name eigo.email www.eigo.email;
    
    ssl_certificate /etc/letsencrypt/live/eigo.email/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eigo.email/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
SSLEOF
        sudo nginx -t && sudo systemctl reload nginx
        print_success "SSL certificates installed"
    } || print_status "SSL setup skipped (domain may not be pointed to server yet)"
else
    print_status "Certbot not available, SSL setup skipped"
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "your-server-ip")

echo ""
print_success "🎉 Deployment completed successfully!"
echo ""
echo "📋 Your application is accessible at:"
echo "  🌍 http://$SERVER_IP"
echo "  🌍 http://eigo.email"
echo "  🌍 http://localhost:8787 (direct)"
echo ""
echo "📊 Useful commands:"
echo "  pm2 logs language-app                    # View logs"
echo "  pm2 restart language-app                 # Restart app"
echo "  pm2 monit                                # Monitor processes"
echo ""

ENDSSH

print_success "🚀 Deployment complete!"
print_status "Your site is now running on $SERVER"

# Show server status
print_status "📊 Checking server status..."
ssh "$SERVER" "cd $APP_DIR && pm2 status"

echo ""
print_success "✨ All done! Your app is now live at https://eigo.email"

