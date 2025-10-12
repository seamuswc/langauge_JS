# Eigo.email - English Learning for Japanese Speakers

Daily English sentences delivered via email. Deployment Guide for Ubuntu.

## 🚀 Quick Deploy

### Option 1: 🖥️ Deploy from your local machine (Fastest - Recommended!)

Build on your fast local machine, deploy everything to a fresh server:

```bash
./deploy-local.sh root@your-server.com
```

✨ **What it does:**
- Builds React frontend on your fast local machine (much faster than server!)
- Creates deployment package
- **Automatically copies your local .env file** (no manual editing needed!) 🔑
- Copies files to server via SSH/rsync
- Installs Node.js, PM2, Nginx on server
- Configures SSL certificates for eigo.email
- Starts all PM2 services
- Shows you the live URL

🎯 **Best for:** Initial deployment, fast builds, production deployments  
⚡ **Zero manual configuration** - your API keys are deployed automatically!

### Option 2: 🌐 Direct server deploy (slower build)

SSH into your Ubuntu server and run:

```bash
curl -fsSL https://raw.githubusercontent.com/seamuswc/langauge_JS/main/deploy.sh | bash
```

📦 Clones repo on server, builds there (slower), sets up everything automatically  
⚠️ **Note:** Builds on server CPU - slower than local machine

---

## Alternative: Run from Local Clone

To deploy the entire application with one command:

```bash
bash deploy.sh
```

Or using npm:

```bash
npm run deploy
```

## What the Deployment Script Does

The `deploy.sh` script automatically handles:

1. **Code Update**: Pulls latest code from git repository
2. **Dependencies**: Installs all required npm packages
3. **Frontend Build**: Builds the React frontend application
4. **Process Management**: Sets up PM2 for production process management
5. **Services**: Starts both the main app and daily email scheduler
6. **Configuration**: Saves PM2 configuration for persistence

## Prerequisites

- Node.js (v16 or higher)
- npm
- Git (optional, for code updates)
- PM2 (installed automatically if missing)

## Environment Configuration

Before running the deployment, create a `.env` file with your configuration:

```bash
cp .env.example .env
```

Then edit `.env` with your actual values:

```env
# Server Configuration
PORT=8787
HOST=0.0.0.0

# Language Settings (defaults to English for Japanese learners)
SOURCE_LANGUAGE=japanese
TARGET_LANGUAGE=english

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_MERCHANT_ADDRESS=your_merchant_address_here

# Tencent SES Email Service
TENCENT_SES_SECRET_ID=your_tencent_secret_id
TENCENT_SES_SECRET_KEY=your_tencent_secret_key
TENCENT_SES_TEMPLATE_ID_EN=66878  # English template (primary for eigo.email)
TENCENT_SES_TEMPLATE_ID=65685     # Japanese template
TENCENT_SES_TEMPLATE_ID_TH=66672  # Thai template

# DeepSeek AI API
DEEPSEEK_API_KEY=your_deepseek_api_key
```

## PM2 Process Management

The deployment creates two PM2 processes:

1. **language-app**: Main web application server
2. **daily-sentence-mailer**: Daily email scheduler (runs at 9 AM daily)

### Useful PM2 Commands

```bash
# View all processes
pm2 status

# View logs
pm2 logs language-app
pm2 logs daily-sentence-mailer

# Restart services
pm2 restart language-app
pm2 restart daily-sentence-mailer

# Monitor processes
pm2 monit

# Stop all processes
pm2 stop all

# Delete all processes
pm2 delete all
```

## Manual Deployment Steps

If you prefer to deploy manually:

1. **Pull latest code**:
   ```bash
   git pull
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build frontend**:
   ```bash
   npm run build
   ```

4. **Start with PM2**:
   ```bash
   pm2 start server.js --name "language-app" --watch
   pm2 start scripts/sendDaily.js --name "daily-sentence-mailer" --cron "0 9 * * *" --no-autorestart
   pm2 save
   ```

## Troubleshooting

### Common Issues

1. **Port already in use**: Change the PORT in your `.env` file
2. **PM2 not found**: The script will install PM2 globally automatically
3. **Build failures**: Check that all dependencies are installed correctly
4. **Environment variables**: Ensure your `.env` file is properly configured

### Logs and Debugging

```bash
# View application logs
pm2 logs language-app --lines 100

# View email scheduler logs
pm2 logs daily-sentence-mailer --lines 100

# Monitor real-time
pm2 monit
```

### Restart Services

```bash
# Restart main application
pm2 restart language-app

# Restart email scheduler
pm2 restart daily-sentence-mailer

# Full restart
pm2 restart all
```

## Production Considerations

- Ensure your server has sufficient memory (recommended: 1GB+)
- Set up proper firewall rules for your chosen port
- Consider using a reverse proxy (nginx) for production
- Set up log rotation for PM2 logs
- Configure automatic PM2 startup on server reboot: `pm2 startup`

## Support

For issues or questions, check the application logs and ensure all environment variables are properly configured.
