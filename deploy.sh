#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SERVER_HOST="${1:-159.223.37.126}"
SERVER_USER="${2:-root}"
SERVER_PATH="/var/www/eigo-email"
PROJECT_NAME="eigo-email"

# Helper functions
print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running locally or on server
if [[ "$1" == "--server" ]]; then
    # Running ON the server
    print_status "🚀 Setting up server environment..."
    
    # Update system
    print_status "Updating system packages..."
    apt-get update -y && apt-get upgrade -y
    
    # Install Node.js
    if ! command -v node &> /dev/null; then
        print_status "Installing Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
    
    # Install PM2
    if ! command -v pm2 &> /dev/null; then
        print_status "Installing PM2..."
        npm install -g pm2
    fi
    
    # Install Nginx
    if ! command -v nginx &> /dev/null; then
        print_status "Installing Nginx..."
        apt-get install -y nginx
        systemctl enable nginx
        systemctl start nginx
    fi
    
    # Install dependencies
    print_status "Installing project dependencies..."
    npm install
    
    # Build frontend
    print_status "Building frontend..."
    npm run build
    
    # Configure Nginx
    print_status "Configuring Nginx..."
    cat > /etc/nginx/sites-available/$PROJECT_NAME << 'EOF'
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
    
    ln -sf /etc/nginx/sites-available/$PROJECT_NAME /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    
    # Install certbot
    if ! command -v certbot &> /dev/null; then
        print_status "Installing certbot..."
        apt-get install -y snapd
        snap install core && snap refresh core
        snap install --classic certbot
        ln -sf /snap/bin/certbot /usr/bin/certbot
    fi
    
    # Setup SSL
    print_status "Setting up SSL certificates..."
    certbot certonly --standalone -d eigo.email -d www.eigo.email --non-interactive --agree-tos --email admin@eigo.email 2>/dev/null && {
            cat > /etc/nginx/sites-available/$PROJECT_NAME << 'SSLEOF'
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
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
SSLEOF
            nginx -t && systemctl reload nginx
            print_success "SSL certificates configured"
        } || print_warning "SSL setup failed - continuing without HTTPS"
    
    # Setup firewall
    if command -v ufw &> /dev/null; then
        print_status "Configuring firewall..."
        ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 8787
        ufw --force enable
    fi
    
    # Stop existing processes
    pm2 delete all 2>/dev/null || true
    
    # Start application
    print_status "Starting application..."
    pm2 start server.js --name "language-app" --watch --max-memory-restart 500M
    pm2 start scripts/sendDaily.js --name "daily-sentence-mailer" --cron "0 9 * * *" --no-autorestart
    pm2 save
    pm2 startup systemd -u $(whoami) --hp $HOME | grep "sudo" | bash || true
    
    # Test deployment
    sleep 5
    if curl -s http://localhost:8787/health | grep -q "ok"; then
        print_success "🎉 Deployment successful!"
        print_success "Site: http://$SERVER_HOST:8787"
        print_success "Admin: http://$SERVER_HOST:8787/admin"
    else
        print_error "Deployment failed - health check failed"
        exit 1
    fi
    
else
    # Running FROM local machine
    print_status "🚀 Deploying to $SERVER_HOST..."
    
    # Build locally
    print_status "Building project..."
    npm run build
    
    # Add server to known hosts
    print_status "Adding server to known hosts..."
    ssh-keyscan -H $SERVER_HOST >> ~/.ssh/known_hosts 2>/dev/null || true
    
    # Create remote directory
    print_status "Creating remote directory..."
    ssh $SERVER_USER@$SERVER_HOST "mkdir -p $SERVER_PATH"
    
    # Upload files
    print_status "Uploading files..."
    rsync -avz --delete \
        --exclude 'node_modules' \
        --exclude '.git' \
        --exclude 'react-ui/node_modules' \
        --exclude 'react-ui/dist' \
        . $SERVER_USER@$SERVER_HOST:$SERVER_PATH/
    
    # Run server setup
    print_status "Running server setup..."
    ssh $SERVER_USER@$SERVER_HOST "cd $SERVER_PATH && chmod +x deploy.sh && ./deploy.sh --server"
    
    # Test deployment
    print_status "Testing deployment..."
    sleep 10
    if curl -s http://$SERVER_HOST:8787/health | grep -q "ok"; then
        print_success "🎉 Deployment successful!"
        print_success "Site: http://$SERVER_HOST:8787"
        print_success "Admin: http://$SERVER_HOST:8787/admin"
        print_success "Daily emails: 9 AM Tokyo time"
    else
        print_error "Deployment failed - health check failed"
        exit 1
    fi
fi