# LinkedIn URL Finder API

A simple API service that finds LinkedIn profile URLs using Bing search. No LinkedIn login required.

## Features
- Searches for LinkedIn profiles using name and company
- Uses Bing search (no CAPTCHAs)
- Headless browser automation
- Rate limiting (500 searches/day)
- Simple REST API

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
```

The API will be available at `http://localhost:3000`

### API Endpoints

**POST /scrape**
```json
{
  "searchQuery": "John Doe",
  "company": "Microsoft"
}
```

Response:
```json
{
  "success": true,
  "name": "John Doe",
  "profileUrl": "https://www.linkedin.com/in/johndoe/",
  "scrapedAt": "2025-08-19T12:00:00.000Z"
}
```

**GET /health**
- Returns server status and daily usage count

## Environment Variables

Optional - set the PORT:
```
PORT=3000
```

## Deployment

### Heroku
1. Create a new Heroku app
2. Add Puppeteer buildpack: `heroku/nodejs` and `jontewks/puppeteer`
3. Deploy via Git

### Railway
1. Create new project
2. Deploy from GitHub
3. Set environment variables if needed

### Render
1. Create new Web Service
2. Connect GitHub repo
3. Build command: `npm install`
4. Start command: `npm start`

## License
ISC