## Daily Sentence — Deployment Guide (Ubuntu)

Fastify (Node.js) API serving a React (Vite) frontend.

### Requirements
- Ubuntu with sudo
- Node.js 20+ and npm
- Nginx and UFW
- Outbound access to `api.deepseek.com`, SES/Tencent SES, and a Solana RPC

### 1) Install packages and Node.js
```bash
sudo apt update
sudo apt install -y git curl build-essential ufw nginx snapd
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

### 2) Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow "Nginx Full"
sudo ufw enable
```

### 3) Get the code
```bash
sudo mkdir -p /var/www/nihongo-email
cd /var/www/nihongo-email
git clone https://github.com/seamuswc/langauge_JS.git .
```

### 4) Environment
Run from: `/var/www/nihongo-email`

Create a `.env` file in the project root with your keys and settings.

### 5) Install and build
Run from: `/var/www/nihongo-email`
```bash
npm ci || npm install
npm run build
```

### 6) Live Deployment with PM2

For production deployments with hot reloading:

```bash
# Start with PM2 (auto-restart on file changes)
pm2 start server.js --name "language-app" --watch

# Deploy new code (rebuilds frontend and restarts)
npm run deploy
```

### 6) Nginx reverse proxy (HTTP)
```bash
sudo tee /etc/nginx/sites-available/nihongo-email >/dev/null <<'NGINX'
server {
  listen 80;
  server_name nihongo.email;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
NGINX
sudo ln -s /etc/nginx/sites-available/nihongo-email /etc/nginx/sites-enabled/nihongo-email
sudo nginx -t && sudo systemctl reload nginx
```

### 7) HTTPS with Let’s Encrypt
```bash
sudo snap install core && sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d nihongo.email
```

### 8) Schedule daily emails (PM2 cron)
Run from: `/var/www/nihongo-email`
```bash
pm2 start scripts/sendDaily.js --name daily-sentence-mailer --cron "0 9 * * *" --no-autorestart
pm2 save
```

### 9) Run with pm2 (start last)
Run from: `/var/www/nihongo-email`
```bash
pm2 start server.js --name daily-sentence -i max
pm2 save
pm2 startup   # run the printed command once
```

### Verify
```bash
curl -s http://127.0.0.1:8787/health   # {"ok": true}
pm2 status && pm2 logs daily-sentence --lines 50
```

###pull, run, restart
cd /var/www/nihongo-email
git restore --staged package-lock.json 2>/dev/null || true
git restore package-lock.json            # or: git checkout -- package-lock.json
git pull
npm ci || npm install
npm run build
pm2 reload daily-sentence

### Email (Tencent Cloud SES)
- Uses Tencent SDK (`tencentcloud-sdk-nodejs`) with service SES v2020-10-02.
- Required env: `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_SES_REGION` (e.g., ap-hongkong), `TENCENT_SES_SENDER` (verified).
- After pulling changes that modify server deps: run `npm ci` (or `npm install`) at project root.

#### Email Templates
The system uses different email templates for different languages:
- **Japanese Template**: `TENCENT_SES_TEMPLATE_ID` (default: 65685) - for Japanese sentences
- **English Template**: `TENCENT_SES_TEMPLATE_ID_EN` (default: 65687) - for English sentences  
- **Thai Templates**: `TENCENT_SES_TEMPLATE_ID_TH` 
  - **Template ID 66673**: For users with native language = Japanese (Japanese interface)
  - **Template ID 66672**: For users with native language = English (English interface)

The system automatically selects the correct Thai template based on the user's native language.

Template files are available in `email-templates/` directory for reference.

### Payment Configuration

#### Solana Payments (Default - Works out of the box)
- Uses default merchant address: `8zS5w8MHSDQ4Pc12DZRLYQ78hgEwnBemVJMrfjUN6xXj`
- Optional env: `SOLANA_MERCHANT_ADDRESS`, `SOLANA_RPC_URL`
- Integrates with Phantom wallet automatically

#### Sui Payments (Optional - Requires configuration)
To enable Sui payments, add these environment variables:
```bash
SUI_MERCHANT_ADDRESS=0x...  # Your Sui merchant address
SUI_USDC_COIN_TYPE=0x...::usdc::USDC  # Sui USDC coin type
SUI_RPC_URL=https://fullnode.mainnet.sui.io  # Optional, has default
```

#### Aptos Payments (Optional - Requires configuration)
To enable Aptos payments, add these environment variables:
```bash
APTOS_MERCHANT_ADDRESS=0x...  # Your Aptos merchant address
APTOS_USDC_COIN_TYPE=0x...::usdc::USDC  # Aptos USDC coin type
APTOS_RPC_URL=https://fullnode.mainnet.aptoslabs.com  # Optional, has default
```

**Note**: Without Sui/Aptos configuration, the buttons will still work but show a "not configured" message. Users can still use Solana payments.

Notes: App writes JSON to `data/`. Keep 8787 private (127.0.0.1) and expose only 80/443 via Nginx. Using `/var/www/nihongo-email` keeps web app files in the conventional web root. If you run as root, `chown $USER:$USER` is not required.


