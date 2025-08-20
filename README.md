# LinkedIn URL Finder API

A robust API service that finds LinkedIn profile URLs using Bing search. Built for HubSpot integration via n8n workflows. No LinkedIn login required.

## Features
- 🔍 Searches for LinkedIn profiles using name and company
- 🤖 Uses Bing search with Puppeteer (no CAPTCHAs)
- 🛡️ Stealth mode with anti-detection measures
- ⏱️ Rate limiting (500 searches/day)
- 📊 Daily usage tracking and health monitoring
- 🔄 n8n workflow integration ready
- 📝 Comprehensive logging system

## Prerequisites
- Node.js 18.x or higher
- npm or yarn
- Chrome/Chromium (automatically installed by Puppeteer)

## Installation

### Local Development
```bash
# Clone the repository
git clone [your-repo-url]
cd linkedin-scraper

# Install dependencies
npm install
```

### DigitalOcean VPS Deployment

1. **Run the setup script** (Ubuntu 22.04):
```bash
chmod +x deploy-digitalocean.sh
sudo ./deploy-digitalocean.sh
```

2. **Clone and setup the application**:
```bash
cd /opt
git clone [your-repo-url] linkedin-url-finder
cd linkedin-url-finder
npm install
```

3. **Start with PM2**:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

4. **Configure Nginx** (optional):
```bash
sudo cp nginx.conf /etc/nginx/sites-available/linkedin-finder
sudo ln -s /etc/nginx/sites-available/linkedin-finder /etc/nginx/sites-enabled/
# Edit the file to add your domain/IP
sudo nano /etc/nginx/sites-available/linkedin-finder
sudo nginx -t
sudo systemctl restart nginx
```

## Usage

### Start the server
```bash
# Development
npm start

# Production with PM2
pm2 start ecosystem.config.js
```

The API will be available at `http://localhost:3000`

### API Endpoints

#### **POST /scrape**
Find LinkedIn profile URL for a person.

Request:
```json
{
  "searchQuery": "John Doe",
  "company": "Microsoft",
  "contactId": "optional-hubspot-id"
}
```

Response (Success):
```json
{
  "success": true,
  "name": "John Doe",
  "profileUrl": "https://www.linkedin.com/in/johndoe/",
  "contactId": "optional-hubspot-id",
  "scrapedAt": "2025-08-19T12:00:00.000Z"
}
```

Response (Error):
```json
{
  "success": false,
  "error": "No LinkedIn profile found"
}
```

#### **GET /health**
Check server status and daily usage.

Response:
```json
{
  "status": "healthy",
  "dailySearches": 42,
  "dailyLimit": 500,
  "uptime": 3600
}
```

## n8n Integration

This API is designed to work with n8n workflows for HubSpot contact enrichment:

1. **n8n HTTP Request Node Configuration**:
   - Method: `POST`
   - URL: `http://your-server:3000/scrape`
   - Authentication: None required
   - Headers: `Content-Type: application/json`
   - Body: JSON with searchQuery, company, and contactId

2. **Workflow Pattern**:
   - Get contacts from HubSpot
   - Loop through contacts
   - Call this API for each contact
   - Update HubSpot with LinkedIn URLs

## Configuration

### Environment Variables
Create a `.env` file (optional):
```env
PORT=3000
MAX_DAILY_SEARCHES=500
```

### PM2 Configuration
The `ecosystem.config.js` file contains PM2 settings:
- Auto-restart on failure
- Memory limits
- Log rotation
- Environment variables

## Project Structure
```
linkedin-scraper/
├── scraper.js           # Main application file
├── package.json         # Dependencies
├── ecosystem.config.js  # PM2 configuration
├── deploy-digitalocean.sh # VPS setup script
├── nginx.conf          # Nginx proxy configuration
├── logs/               # Application logs (gitignored)
└── README.md           # This file
```

## Monitoring

### Logs
- Application logs: `logs/linkedin-finder-YYYY-MM-DD.log`
- PM2 logs: `pm2 logs linkedin-finder`
- PM2 monitoring: `pm2 monit`

### Health Checks
```bash
# Check API health
curl http://localhost:3000/health

# Check PM2 status
pm2 status

# View real-time logs
pm2 logs linkedin-finder --lines 100
```

## Troubleshooting

### Common Issues

1. **"No LinkedIn profile found"**
   - Verify the person's name and company are correct
   - Try simplifying the search query
   - Check if daily limit is reached

2. **Puppeteer fails to launch**
   - Ensure all Chrome dependencies are installed
   - Run: `sudo apt-get install -y chromium-browser`
   - Check available memory: `free -h`

3. **Port already in use**
   - Change port in `.env` or `ecosystem.config.js`
   - Kill existing process: `lsof -ti:3000 | xargs kill`

4. **Rate limit reached**
   - Default limit is 500/day
   - Resets at midnight
   - Adjust `MAX_DAILY_SEARCHES` in code if needed

## Security Notes
- No LinkedIn credentials required
- Uses Bing search (public data only)
- Rate limiting prevents abuse
- Stealth plugin for anti-detection
- No data is stored permanently

## Contributing
Pull requests are welcome. For major changes, please open an issue first.

## License
ISC

## Disclaimer
This tool is for legitimate business purposes only. Always respect LinkedIn's terms of service and privacy policies. Use responsibly for contact enrichment and professional networking purposes.