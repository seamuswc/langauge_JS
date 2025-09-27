#!/bin/bash

# Reset PM2 and setup correctly
# Run from: /var/www/nihongo-email

echo "🔄 Resetting PM2 and setting up application..."

# Stop and delete all existing PM2 processes
echo "📦 Cleaning up existing PM2 processes..."
pm2 delete all

# Pull latest code
echo "📥 Pulling latest code..."
git pull

# Install dependencies
echo "📦 Installing dependencies..."
npm ci || npm install

# Build frontend
echo "🏗️  Building frontend..."
npm run build

# Start main application with correct name
echo "🚀 Starting main application..."
pm2 start server.js --name "language-app" --watch

# Start daily email scheduler
echo "📧 Starting daily email scheduler..."
pm2 start scripts/sendDaily.js --name daily-sentence-mailer --cron "0 9 * * *" --no-autorestart

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Show status
echo "✅ Setup complete! PM2 status:"
pm2 status

echo ""
echo "📋 Useful commands:"
echo "  pm2 logs language-app"
echo "  pm2 logs daily-sentence-mailer"
echo "  pm2 restart language-app"
echo "  npm run deploy  # for future updates"
