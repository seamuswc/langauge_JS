# Language Learning App - Deployment Guide

## Quick Deployment

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

# Language Settings
SOURCE_LANGUAGE=english
TARGET_LANGUAGE=japanese

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_MERCHANT_ADDRESS=your_merchant_address_here

# Tencent SES Email Service
TENCENT_SES_SECRET_ID=your_tencent_secret_id
TENCENT_SES_SECRET_KEY=your_tencent_secret_key
TENCENT_SES_TEMPLATE_ID=your_default_template_id
TENCENT_SES_TEMPLATE_ID_EN=your_english_template_id
TENCENT_SES_TEMPLATE_ID_TH=your_thai_template_id

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
