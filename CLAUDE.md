# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a LinkedIn profile scraper with n8n workflow integration for HubSpot contact enrichment. The system consists of:
1. A Node.js Express API that uses Puppeteer to scrape LinkedIn profiles
2. An n8n workflow that orchestrates the enrichment process from HubSpot

## Architecture

### LinkedIn Scraper (`C:\opt\linkedin-scraper\`)
- **Technology**: Node.js, Express, Puppeteer with stealth plugin
- **Main file**: `scraper.js` - Express API server with LinkedIn scraping logic
- **Port**: 3000 (localhost)
- **Rate limit**: 45 contacts per day (hardcoded safety limit)

### Key Dependencies
- `puppeteer-extra` + `puppeteer-extra-plugin-stealth`: Browser automation with anti-detection
- `express`: API server
- `cors`: Cross-origin support for n8n integration
- `dotenv`: Environment variable management

## Commands

### Running the Scraper
```bash
cd C:\opt\linkedin-scraper
node scraper.js
```

### Exposing API (for n8n)
```bash
# Use ngrok to expose local API
ngrok http 3000
```

## API Endpoints

### POST `/scrape`
Searches for and scrapes a LinkedIn profile.

Request body:
```json
{
  "searchQuery": "Person Name",
  "company": "Company Name",
  "contactId": "HubSpot_ID"
}
```

Response:
```json
{
  "success": true,
  "name": "Person Name",
  "headline": "Job Title",
  "location": "City, Country",
  "about": "Bio text",
  "profileUrl": "https://www.linkedin.com/in/username/",
  "contactId": "HubSpot_ID",
  "scrapedAt": "ISO timestamp"
}
```

### GET `/health`
Returns scraper status and daily usage count.

## n8n Workflow Structure

The workflow (`My_workflow_complete.json`) follows this flow:
1. **Get HubSpot Contacts** → Filter by `hubspot_enrichment` = "send-to-n8n"
2. **Loop Over Contacts** → Process each contact individually
3. **Get Company Data** → Fetch associated company from HubSpot
4. **Merge Contact and Company** → Combine data for search
5. **Call LinkedIn Scraper API** → Send to scraper endpoint
6. **Process Response** → Extract LinkedIn URL
7. **Update HubSpot** → Save enriched data back

### Required HubSpot Custom Properties
- `linkedin_url`: Stores the scraped LinkedIn profile URL
- `enrichment_date`: Timestamp of last enrichment
- `hubspot_enrichment`: Status field (send-to-n8n, enriched, error)

## Configuration Requirements

### Environment Variables (`.env` file in scraper directory)
```
LINKEDIN_EMAIL=your_linkedin_email
LINKEDIN_PASSWORD=your_linkedin_password
```

### n8n HTTP Request Node Configuration
- URL: `http://localhost:3000/scrape` (or ngrok URL)
- Method: POST
- Headers: `Content-Type: application/json`
- Body: JSON with searchQuery, company, contactId

## Logging and Debugging

The scraper creates detailed logs in `C:\opt\linkedin-scraper\logs\`:
- Daily log files: `scraper-YYYY-MM-DD.log`
- HTML snapshots: `after-login-[timestamp].html`
- Error screenshots: `debug-*.png`

## Important Implementation Details

### Search Strategy
The scraper uses LinkedIn's search bar directly by:
1. Navigating to the feed page
2. Clicking the search input
3. Typing the full search query (name + company)
4. Pressing Enter and waiting for results
5. Clicking the first profile result

### Session Management
- Login happens on first request
- Cookies are stored in memory for session reuse
- Re-login triggered if session expires

### Error Handling
- LinkedIn verification challenges: Waits 60 seconds for manual completion
- Navigation timeouts: Continues execution with logged warnings
- No results found: Returns error with debug screenshot

## Common Issues and Solutions

1. **"Search bar not found"**: LinkedIn UI changed or session issue - check HTML snapshots
2. **Daily limit reached**: Wait until next day or increase MAX_DAILY constant
3. **Login failures**: Check credentials in .env file
4. **No search results**: Verify the contact name and company data quality in HubSpot

## File Locations

- Scraper application: `C:\opt\linkedin-scraper\`
- n8n workflows: `C:\Users\sam.schalkwijk\Downloads\*.json`
- Logs and debug files: `C:\opt\linkedin-scraper\logs\`