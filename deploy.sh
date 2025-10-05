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

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
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

# Step 10: Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning "⚠️  No .env file found. You may need to create one with your environment variables."
    echo ""
    echo "Required environment variables (create .env file):"
    echo "  PORT=8787"
    echo "  HOST=0.0.0.0"
    echo "  SOURCE_LANGUAGE=english"
    echo "  TARGET_LANGUAGE=japanese"
    echo "  SOLANA_RPC_URL=https://api.mainnet-beta.solana.com"
    echo "  SOLANA_MERCHANT_ADDRESS=your_merchant_address"
    echo "  TENCENT_SES_SECRET_ID=your_secret_id"
    echo "  TENCENT_SES_SECRET_KEY=your_secret_key"
    echo "  TENCENT_SES_TEMPLATE_ID=your_template_id"
    echo "  TENCENT_SES_TEMPLATE_ID_EN=your_english_template_id"
    echo "  TENCENT_SES_TEMPLATE_ID_TH=your_thai_template_id"
    echo "  DEEPSEEK_API_KEY=your_deepseek_api_key"
    echo ""
fi

print_success "🚀 Language Learning App is now running!"
