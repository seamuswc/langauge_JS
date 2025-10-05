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
        # Linux - install Node.js via NodeSource repository
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
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

# Step 1: Pull latest code (if git is available and not in a clean state)
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

# Step 2: Install dependencies
print_status "📦 Installing dependencies..."
npm ci --production=false || npm install
print_success "Dependencies installed"

# Step 3: Build React frontend
print_status "🏗️  Building React frontend..."
npm run build
print_success "Frontend built successfully"

# Step 4: Stop existing PM2 processes
print_status "🔄 Managing PM2 processes..."
pm2 delete all 2>/dev/null || print_warning "No existing PM2 processes to delete"

# Step 5: Start main application
print_status "🚀 Starting main application..."
pm2 start server.js --name "language-app" --watch --max-memory-restart 500M
print_success "Main application started"

# Step 6: Start daily email scheduler
print_status "📧 Setting up daily email scheduler..."
pm2 start scripts/sendDaily.js --name "daily-sentence-mailer" --cron "0 9 * * *" --no-autorestart
print_success "Daily email scheduler configured"

# Step 7: Save PM2 configuration
print_status "💾 Saving PM2 configuration..."
pm2 save
print_success "PM2 configuration saved"

# Step 8: Show final status
print_status "📊 Deployment Status:"
echo ""
pm2 status
echo ""

# Step 9: Display useful information
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

# Step 10: Setup domain and environment
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

# Create Nginx configuration
print_status "🔧 Configuring Nginx reverse proxy..."
NGINX_CONFIG="/etc/nginx/sites-available/language-app"
NGINX_ENABLED="/etc/nginx/sites-enabled/language-app"

# Get server IP for default configuration
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "your-server-ip")

sudo tee $NGINX_CONFIG > /dev/null << EOF
server {
    listen 80;
    server_name $SERVER_IP _;
    
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

print_success "Nginx configured for port 80 -> 8787"

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

# Check if domain is configured
DOMAIN_CONFIGURED=false
if [ -f "/etc/nginx/sites-available/language-app" ]; then
    CURRENT_DOMAIN=$(grep "server_name" /etc/nginx/sites-available/language-app | awk '{print $2}' | head -1)
    if [[ "$CURRENT_DOMAIN" != "_" && "$CURRENT_DOMAIN" != "$SERVER_IP" ]]; then
        DOMAIN_CONFIGURED=true
        print_success "Domain detected: $CURRENT_DOMAIN"
    fi
fi

# Setup SSL if domain is configured
if [ "$DOMAIN_CONFIGURED" = true ]; then
    print_status "🔐 Setting up SSL certificate for $CURRENT_DOMAIN..."
    
    # Update Nginx config for SSL
    sudo tee /etc/nginx/sites-available/language-app > /dev/null << EOF
server {
    listen 80;
    server_name $CURRENT_DOMAIN;
    
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name $CURRENT_DOMAIN;
    
    ssl_certificate /etc/letsencrypt/live/$CURRENT_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$CURRENT_DOMAIN/privkey.pem;
    
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

    # Get SSL certificate
    print_status "🔐 Obtaining SSL certificate..."
    sudo certbot --nginx -d $CURRENT_DOMAIN --non-interactive --agree-tos --email admin@$CURRENT_DOMAIN --redirect
    
    # Setup auto-renewal
    print_status "🔄 Setting up SSL auto-renewal..."
    (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    
    print_success "🔒 SSL certificate installed and auto-renewal configured"
    SSL_URL="https://$CURRENT_DOMAIN"
else
    print_warning "⚠️  No custom domain configured. SSL setup skipped."
    print_warning "To enable SSL:"
    print_warning "  1. Point your domain DNS to: $SERVER_IP"
    print_warning "  2. Update /etc/nginx/sites-available/language-app"
    print_warning "  3. Change 'server_name' to your domain"
    print_warning "  4. Run: sudo certbot --nginx -d your-domain.com"
    SSL_URL=""
fi

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx

# Display access information
print_success "🌐 Your application is now accessible at:"
echo ""
echo "  🌍 http://$SERVER_IP"
if [ "$DOMAIN_CONFIGURED" = true ]; then
    echo "  🔒 https://$CURRENT_DOMAIN (SSL enabled)"
    echo "  🌍 http://$CURRENT_DOMAIN (redirects to HTTPS)"
fi
echo "  🌍 http://localhost:8787 (direct access)"
echo ""
if [ "$DOMAIN_CONFIGURED" = false ]; then
    echo "📋 To configure a custom domain with SSL:"
    echo "  1. Point your domain's DNS to: $SERVER_IP"
    echo "  2. Update /etc/nginx/sites-available/language-app"
    echo "  3. Change 'server_name' to your domain"
    echo "  4. Run: sudo certbot --nginx -d your-domain.com"
    echo "  5. Run: sudo nginx -t && sudo systemctl reload nginx"
    echo ""
fi

print_success "🚀 Language Learning App is now running!"
