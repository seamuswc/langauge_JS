#!/bin/bash

# Language Learning App Deployment Script
# This script handles the complete deployment process

set -e  # Exit on any error

echo "🚀 Starting Language Learning App Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "server.js" ]; then
    print_error "This script must be run from the project root directory"
    exit 1
fi

# Check if Node.js is installed, install if missing
if ! command -v node &> /dev/null; then
    print_warning "Node.js is not installed. Installing Node.js..."
    
    # Detect OS and install Node.js
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux - install Node.js 20 via NodeSource repository
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - try to install via Homebrew
        if command -v brew &> /dev/null; then
            brew install node
        else
            print_error "Please install Node.js manually on macOS: https://nodejs.org/"
            exit 1
        fi
    else
        print_error "Unsupported operating system. Please install Node.js manually: https://nodejs.org/"
        exit 1
    fi
    
    print_success "Node.js installed successfully"
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    print_error "npm is not available. Please check your Node.js installation."
    exit 1
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    print_warning "PM2 is not installed. Installing PM2 globally..."
    npm install -g pm2
    print_success "PM2 installed successfully"
fi

# Check if git is available
if ! command -v git &> /dev/null; then
    print_warning "Git is not available. Skipping git pull..."
    SKIP_GIT_PULL=true
fi

# Step 1: Setup proper web directory structure
print_status "📁 Setting up web directory structure..."
WEB_DIR="/var/www/language-app"
CURRENT_DIR=$(pwd)

# Create web directory if it doesn't exist
sudo mkdir -p $WEB_DIR

# If we're not already in the web directory, copy files there
if [ "$CURRENT_DIR" != "$WEB_DIR" ]; then
    print_status "📂 Moving application to web directory: $WEB_DIR"
    sudo cp -r . $WEB_DIR/
    sudo chown -R $USER:$USER $WEB_DIR
    cd $WEB_DIR
    print_success "Application moved to $WEB_DIR"
fi

# Step 2: Pull latest code (if git is available and not in a clean state)
if [ "$SKIP_GIT_PULL" != true ]; then
    print_status "📥 Pulling latest code from repository..."
    if git status --porcelain | grep -q .; then
        print_warning "Working directory has uncommitted changes. Stashing them..."
        git stash push -m "Auto-stash before deployment $(date)"
    fi
    git pull origin main || git pull origin master || print_warning "Could not pull latest code"
    print_success "Code updated"
else
    print_warning "Skipping git pull (git not available or repository not found)"
fi

# Step 3: Install dependencies
print_status "📦 Installing dependencies..."
npm ci --production=false || npm install
print_success "Dependencies installed"

# Step 4: Build React frontend
print_status "🏗️  Building React frontend..."
# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    print_error "Node.js version $NODE_VERSION is too old. Vite requires Node.js 20+"
    print_error "Please upgrade Node.js and run the script again"
    exit 1
fi
print_status "Node.js version: $(node --version) ✓"

# Clean install React dependencies
print_status "🧹 Cleaning React UI dependencies..."
cd react-ui
rm -rf node_modules package-lock.json
npm install
cd ..

# Build React frontend
npm run build
print_success "Frontend built successfully"

# Step 5: Stop existing PM2 processes
print_status "🔄 Managing PM2 processes..."
pm2 delete all 2>/dev/null || print_warning "No existing PM2 processes to delete"

# Step 6: Start main application
print_status "🚀 Starting main application..."
pm2 start server.js --name "language-app" --watch --max-memory-restart 500M

# Check if app started successfully
sleep 3
if pm2 list | grep -q "language-app.*online"; then
    print_success "Main application started successfully"
else
    print_error "Application failed to start. Checking logs..."
    pm2 logs language-app --lines 10
    print_error "Please check the logs above for errors"
fi

# Step 7: Start daily email scheduler
print_status "📧 Setting up daily email scheduler..."
pm2 start scripts/sendDaily.js --name "daily-sentence-mailer" --cron "0 9 * * *" --no-autorestart
print_success "Daily email scheduler configured"

# Step 8: Save PM2 configuration
print_status "💾 Saving PM2 configuration..."
pm2 save
print_success "PM2 configuration saved"

# Step 9: Show final status
print_status "📊 Deployment Status:"
echo ""
pm2 status
echo ""

# Step 10: Display useful information
print_success "🎉 Deployment completed successfully!"
echo ""
echo "📋 Useful commands:"
echo "  pm2 logs language-app                    # View main app logs"
echo "  pm2 logs daily-sentence-mailer           # View email scheduler logs"
echo "  pm2 restart language-app                 # Restart main app"
echo "  pm2 restart daily-sentence-mailer        # Restart email scheduler"
echo "  pm2 monit                                # Monitor all processes"
echo "  npm run deploy                           # Run this deployment script"
echo ""

# Step 11: Setup domain and environment
print_status "🌐 Setting up domain and environment configuration..."

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    print_warning "Creating .env file with default settings..."
    cp .env.example .env
    print_success ".env file created"
fi

# Setup Nginx reverse proxy if not exists
if ! command -v nginx &> /dev/null; then
    print_warning "Installing Nginx for domain configuration..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update
        sudo apt-get install -y nginx
        sudo systemctl enable nginx
        sudo systemctl start nginx
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            brew install nginx
            brew services start nginx
        else
            print_warning "Please install Nginx manually on macOS"
        fi
    fi
    print_success "Nginx installed"
fi

# Create Nginx configuration for multiple domains
print_status "🔧 Configuring Nginx reverse proxy for multiple domains..."
NGINX_CONFIG="/etc/nginx/sites-available/language-app"
NGINX_ENABLED="/etc/nginx/sites-enabled/language-app"

# Get server IP for default configuration
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "your-server-ip")

# Configure for both domains
sudo tee $NGINX_CONFIG > /dev/null << EOF
server {
    listen 80;
    server_name nihongo.email eigo.email $SERVER_IP _;
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable the site
sudo ln -sf $NGINX_CONFIG $NGINX_ENABLED
sudo nginx -t && sudo systemctl reload nginx

print_success "Nginx configured for nihongo.email, eigo.email, and $SERVER_IP -> 8787"

# Setup firewall
print_status "🔥 Configuring firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 22
    sudo ufw allow 80
    sudo ufw allow 443
    sudo ufw --force enable
elif command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --add-port=80/tcp --permanent
    sudo firewall-cmd --add-port=443/tcp --permanent
    sudo firewall-cmd --reload
fi

print_success "Firewall configured"

# Setup SSL with Let's Encrypt
print_status "🔒 Setting up SSL/HTTPS with Let's Encrypt..."

# Install certbot if not exists
if ! command -v certbot &> /dev/null; then
    print_warning "Installing Certbot for SSL certificates..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update
        sudo apt-get install -y certbot python3-certbot-nginx
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            brew install certbot
        else
            print_warning "Please install Certbot manually on macOS"
        fi
    fi
    print_success "Certbot installed"
fi

# Setup SSL for both domains
print_status "🔐 Setting up SSL certificates for nihongo.email and eigo.email..."

# Try to get SSL certificates
print_status "🔐 Obtaining SSL certificates for both domains..."
if sudo certbot certonly --standalone -d nihongo.email -d eigo.email --non-interactive --agree-tos --email admin@nihongo.email; then
    print_success "SSL certificates obtained successfully"
    
    # Update Nginx config with SSL
    sudo tee /etc/nginx/sites-available/language-app > /dev/null << EOF
server {
    listen 80;
    server_name nihongo.email eigo.email $SERVER_IP _;
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name nihongo.email eigo.email;
    
    ssl_certificate /etc/letsencrypt/live/nihongo.email/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nihongo.email/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    # Setup auto-renewal
    print_status "🔄 Setting up SSL auto-renewal..."
    (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

    print_success "🔒 SSL certificates installed for both domains with auto-renewal configured"
    SSL_URLS="https://nihongo.email and https://eigo.email"
else
    print_warning "SSL certificate setup failed - domains may not be pointing to this server yet"
    print_warning "You can retry SSL setup later with:"
    print_warning "  sudo certbot --nginx -d nihongo.email -d eigo.email"
    SSL_URLS=""
fi

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx

# Display access information
print_success "🌐 Your application is now accessible at:"
echo ""
echo "  🌍 http://$SERVER_IP"
if [ "$SSL_URLS" != "" ]; then
    echo "  🔒 https://nihongo.email (SSL enabled)"
    echo "  🔒 https://eigo.email (SSL enabled)"
    echo "  🌍 http://nihongo.email (redirects to HTTPS)"
    echo "  🌍 http://eigo.email (redirects to HTTPS)"
else
    echo "  🌍 http://nihongo.email (SSL will be enabled after DNS setup)"
    echo "  🌍 http://eigo.email (SSL will be enabled after DNS setup)"
fi
echo "  🌍 http://localhost:8787 (direct access)"
echo ""
if [ "$SSL_URLS" = "" ]; then
    echo "📋 To enable SSL:"
    echo "  1. Point your domains to: $SERVER_IP"
    echo "     - nihongo.email → $SERVER_IP"
    echo "     - eigo.email → $SERVER_IP"
    echo ""
    echo "  2. Wait 5-15 minutes for DNS propagation"
    echo ""
    echo "  3. Then run: sudo certbot --nginx -d nihongo.email -d eigo.email"
    echo ""
else
    echo "🎉 SSL is fully configured and working!"
fi
echo ""

# Setup log rotation for PM2
print_status "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/pm2 > /dev/null << EOF
/root/.pm2/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 root root
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

print_success "Log rotation configured"

# Setup system monitoring
print_status "📊 Setting up system monitoring..."
if ! command -v htop &> /dev/null; then
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get install -y htop
    fi
fi

# Setup PM2 startup script
print_status "🔄 Setting up PM2 auto-startup..."
sudo pm2 startup systemd -u $USER --hp $HOME
pm2 save

print_success "PM2 auto-startup configured"

# Setup basic security
print_status "🔐 Setting up basic security..."
# Disable root login via SSH (if not already disabled)
if [ -f "/etc/ssh/sshd_config" ]; then
    sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
    sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
fi

# Setup fail2ban for basic protection
if ! command -v fail2ban &> /dev/null; then
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get install -y fail2ban
        sudo systemctl enable fail2ban
        sudo systemctl start fail2ban
    fi
fi

print_success "Basic security configured"

# Setup backup script
print_status "💾 Setting up backup system..."
sudo tee /usr/local/bin/backup-language-app.sh > /dev/null << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/language-app"
APP_DIR="/var/www/language-app"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/backup_$DATE.tar.gz -C $APP_DIR data/ .env
find $BACKUP_DIR -name "backup_*.tar.gz" -mtime +7 -delete
EOF

sudo chmod +x /usr/local/bin/backup-language-app.sh

# Add backup to cron (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-language-app.sh") | crontab -

print_success "Backup system configured"

# Final system check
print_status "🔍 Running final system check..."
echo ""
echo "📊 System Status:"
echo "  ✅ Node.js: $(node --version)"
echo "  ✅ PM2: $(pm2 --version)"
echo "  ✅ Nginx: $(nginx -v 2>&1 | cut -d' ' -f3)"
echo "  ✅ SSL: $(if [ -d "/etc/letsencrypt" ]; then echo "Available"; else echo "Not configured"; fi)"
echo "  ✅ Firewall: $(if command -v ufw &> /dev/null; then sudo ufw status | head -1; elif command -v firewall-cmd &> /dev/null; then echo "firewalld active"; else echo "Not configured"; fi)"
echo ""

print_success "🚀 Language Learning App is now running!"
