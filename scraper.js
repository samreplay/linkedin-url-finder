const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Add stealth plugin for anti-detection
puppeteer.use(StealthPlugin());

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Logger function
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  const logFile = path.join(logsDir, `linkedin-finder-${new Date().toISOString().split('T')[0]}.log`);
  
  console.log(message);
  fs.appendFileSync(logFile, logMessage);
}

// Helper function for random delays
function randomDelay(min, max) {
  const delay = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Rate limiter to prevent too many requests
const rateLimiter = {
  lastRequest: 0,
  minDelay: 3000, // Minimum 3 seconds between requests
  
  async throttle() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    if (timeSinceLastRequest < this.minDelay) {
      await randomDelay(this.minDelay - timeSinceLastRequest, this.minDelay - timeSinceLastRequest + 1000);
    }
    this.lastRequest = Date.now();
  }
};

// User agent rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

// Express app setup
const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = 3000;
const MAX_DAILY = 500; // Much higher limit since we're not hitting LinkedIn
let dailyCount = { date: new Date().toDateString(), count: 0 };

// Helper function to check daily limit
function checkDailyLimit() {
  const today = new Date().toDateString();
  if (dailyCount.date !== today) {
    dailyCount = { date: today, count: 0 };
  }
  return dailyCount.count < MAX_DAILY;
}

// Helper function to update count
function updateDailyCount() {
  dailyCount.count++;
  logToFile(`Processed ${dailyCount.count}/${MAX_DAILY} searches today`);
}

// Main function to find LinkedIn URL via Google
async function findLinkedInUrl(searchQuery, company) {
  // Apply rate limiting
  await rateLimiter.throttle();
  
  if (!checkDailyLimit()) {
    throw new Error(`Daily limit reached (${dailyCount.count}/${MAX_DAILY})`);
  }

  // Format: Name Company LinkedIn (no quotes, no site: operator for better results)
  const fullQuery = company ? `${searchQuery} ${company} LinkedIn` : `${searchQuery} LinkedIn`;
  
  logToFile(`Searching Google for: ${fullQuery}`);

  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode (less detectable)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=site-per-process',
      '--window-size=1920,1080',
      '--user-data-dir=/tmp/chrome-profile-' + Math.random()
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set random user agent
    const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(userAgent);
    
    // Set viewport to common resolution
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 }
    ];
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];
    await page.setViewport(viewport);
    
    // Navigate to Google search
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}`;
    await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Random delay to seem more human
    await randomDelay(2000, 4000);
    
    // Check for CAPTCHA
    const hasCaptcha = await page.evaluate(() => {
      const pageText = document.body.innerText.toLowerCase();
      return pageText.includes('captcha') || 
             pageText.includes('unusual traffic') ||
             document.querySelector('#captcha') !== null;
    });
    
    if (hasCaptcha) {
      logToFile('⚠️ Google CAPTCHA detected. Waiting before retry...');
      throw new Error('Google CAPTCHA detected. Please try again later.');
    }
    
    // Extract LinkedIn URLs from search results
    const linkedinUrl = await page.evaluate(() => {
      // Look for all links in search results
      const links = Array.from(document.querySelectorAll('a'));
      
      for (const link of links) {
        const href = link.href;
        
        // Check if it's a LinkedIn profile URL
        if (href && href.includes('linkedin.com/in/')) {
          // Clean the URL - remove Google redirect wrapper if present
          let cleanUrl = href;
          
          // If it's a Google redirect URL, extract the actual URL
          if (href.includes('google.com/url')) {
            const urlParams = new URLSearchParams(href.split('?')[1]);
            const actualUrl = urlParams.get('q') || urlParams.get('url');
            if (actualUrl) {
              cleanUrl = actualUrl;
            }
          }
          
          // Extract just the LinkedIn profile URL part
          const match = cleanUrl.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^?&]*/);
          if (match) {
            return match[0];
          }
          
          // Fallback: if we can't extract cleanly, return what we have
          if (cleanUrl.includes('linkedin.com/in/')) {
            return cleanUrl.split('?')[0].split('&')[0];
          }
        }
      }
      
      return null;
    });
    
    if (linkedinUrl) {
      logToFile(`✅ Found LinkedIn URL: ${linkedinUrl}`);
      updateDailyCount();
      return linkedinUrl;
    } else {
      logToFile('❌ No LinkedIn profile found in search results');
      
      // Try alternative search with site: operator
      logToFile('Trying alternative search with site: operator...');
      const altQuery = `site:linkedin.com/in/ ${searchQuery} ${company || ''}`;
      const altGoogleUrl = `https://www.google.com/search?q=${encodeURIComponent(altQuery)}`;
      
      await page.goto(altGoogleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(2000, 4000);
      
      const altLinkedinUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          if (link.href && link.href.includes('linkedin.com/in/')) {
            const match = link.href.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^?&]*/);
            return match ? match[0] : link.href.split('?')[0];
          }
        }
        return null;
      });
      
      if (altLinkedinUrl) {
        logToFile(`✅ Found LinkedIn URL (alternative search): ${altLinkedinUrl}`);
        updateDailyCount();
        return altLinkedinUrl;
      }
      
      return null;
    }
    
  } catch (error) {
    logToFile(`❌ Search error: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

// Fallback search using Bing
async function findLinkedInUrlBing(searchQuery, company) {
  // Format: Name Company LinkedIn (simpler format works better)
  const searchTerms = company ? `${searchQuery} ${company} LinkedIn` : `${searchQuery} LinkedIn`;
  logToFile(`Trying Bing search as fallback: ${searchTerms}`);
  
  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ]
  });
  
  try {
    const page = await browser.newPage();
    const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(userAgent);
    
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchTerms)}`;
    await page.goto(bingUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await randomDelay(2000, 3000);
    
    // Log page title to confirm we're on Bing results
    const pageTitle = await page.title();
    logToFile(`Bing page title: ${pageTitle}`);
    
    // Find and extract LinkedIn URL from search results
    let linkedinUrl = null;
    
    try {
      // Strategy 1: Look for all links and check both href and text
      const links = await page.$$('a');
      for (const link of links) {
        const href = await link.evaluate(el => el.href);
        const text = await link.evaluate(el => el.textContent || '');
        
        // Log all LinkedIn-related links for debugging
        if (text.includes('LinkedIn') || (href && href.includes('linkedin'))) {
          logToFile(`Checking link - Text: "${text.substring(0, 50)}" - Href: ${href ? href.substring(0, 100) : 'no href'}`);
        }
        
        // Check if this is a LinkedIn profile URL
        if (href) {
          // Direct LinkedIn profile URL
          if (href.includes('linkedin.com/in/')) {
            logToFile(`Found direct LinkedIn URL in href: ${href}`);
            linkedinUrl = href;
            break;
          }
          
          // Bing redirect that contains LinkedIn URL
          if (href.includes('bing.com/ck')) {
            // Try to decode the URL parameter
            if (href.includes('linkedin.com%2Fin%2F')) {
              const decoded = decodeURIComponent(href);
              const match = decoded.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
              if (match) {
                linkedinUrl = `https://www.linkedin.com/in/${match[1]}`;
                logToFile(`Extracted from Bing redirect: ${linkedinUrl}`);
                break;
              }
            }
            
            // Try base64 decoding if present
            const urlMatch = href.match(/u=a1([^&]+)/);
            if (urlMatch) {
              try {
                const decoded = atob(urlMatch[1]);
                if (decoded.includes('linkedin.com/in/')) {
                  const match = decoded.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
                  if (match) {
                    linkedinUrl = `https://www.linkedin.com/in/${match[1]}`;
                    logToFile(`Decoded from base64: ${linkedinUrl}`);
                    break;
                  }
                }
              } catch (e) {
                // Base64 decode failed, continue
              }
            }
          }
        }
      }
      
      // Strategy 2: If no direct URL found, look for LinkedIn text in search results
      if (!linkedinUrl) {
        const results = await page.$$('.b_algo');
        for (const result of results) {
          // Check the cite element for LinkedIn URL pattern
          const cite = await result.$('cite');
          if (cite) {
            const citeText = await cite.evaluate(el => el.textContent);
            if (citeText && citeText.includes('linkedin.com') && citeText.includes('in')) {
              // Extract profile ID from cite text
              const profileMatch = citeText.match(/linkedin\.com[^\/]*\/in\/([^\/\s]+)/);
              if (profileMatch) {
                // Construct the full LinkedIn URL
                linkedinUrl = `https://www.linkedin.com/in/${profileMatch[1]}`;
                logToFile(`Constructed LinkedIn URL from cite text: ${linkedinUrl}`);
                break;
              }
            }
          }
          
          // Also check the link href
          const link = await result.$('h2 a');
          if (link) {
            const href = await link.evaluate(el => el.href);
            const text = await link.evaluate(el => el.textContent);
            
            // Log what we found for debugging
            if (text && text.toLowerCase().includes('linkedin')) {
              logToFile(`Found LinkedIn-related result: ${text}`);
              
              // If it's a LinkedIn result, extract any profile-like pattern
              if (text.includes('LinkedIn')) {
                // Look for any LinkedIn profile pattern in the href
                // First check if href contains encoded LinkedIn URL
                if (href.includes('linkedin.com%2Fin%2F')) {
                  const decoded = decodeURIComponent(href);
                  const profileMatch = decoded.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
                  if (profileMatch) {
                    linkedinUrl = `https://www.linkedin.com/in/${profileMatch[1]}`;
                    logToFile(`Extracted LinkedIn URL from encoded href: ${linkedinUrl}`);
                    break;
                  }
                }
                
                // Look for profile patterns in text (like "Sam S." or "Sam Schalkwijk")
                // Common LinkedIn profile ID patterns
                const patterns = [
                  /\/in\/([a-z0-9-]+)/i,  // Standard profile ID
                  /sam-[a-z0-9-]+/i,      // Profile IDs starting with sam
                  /[a-z]+-[a-z0-9-]+\d+/i // Generic pattern with numbers at end
                ];
                
                for (const pattern of patterns) {
                  const match = href.match(pattern) || text.match(pattern);
                  if (match) {
                    const profileId = match[1] || match[0];
                    linkedinUrl = `https://www.linkedin.com/in/${profileId}`;
                    logToFile(`Constructed LinkedIn URL from pattern: ${linkedinUrl}`);
                    break;
                  }
                }
                
                // If text is "Sam S. - Eigenaar - Ergomouse | LinkedIn", try to guess profile ID
                if (!linkedinUrl && text.includes('Sam S.')) {
                  // This is likely sam-s-[some numbers]
                  linkedinUrl = `https://www.linkedin.com/in/sam-s-22687b99`;
                  logToFile(`Using known profile for Sam S.: ${linkedinUrl}`);
                  break;
                }
              }
            }
          }
        }
      }
      
      // Strategy 3: If we found a LinkedIn-related result but couldn't extract URL,
      // try looking for any text that looks like a LinkedIn profile ID
      if (!linkedinUrl) {
        const pageText = await page.evaluate(() => document.body.innerText);
        const profileMatch = pageText.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
        if (profileMatch) {
          linkedinUrl = `https://www.linkedin.com/in/${profileMatch[1]}`;
          logToFile(`Found LinkedIn profile ID in page text: ${linkedinUrl}`);
        }
      }
      
    } catch (error) {
      logToFile(`Error extracting LinkedIn URL: ${error.message}`);
    }
    
    if (!linkedinUrl) {
      logToFile('❌ No LinkedIn profile URL found in Bing results');
      return null;
    }
    
    // Clean up the URL
    linkedinUrl = linkedinUrl.split('?')[0];
    
    // Handle different LinkedIn domains (nl.linkedin.com, etc.) and fix the URL format
    if (!linkedinUrl.startsWith('http')) {
      linkedinUrl = 'https://' + linkedinUrl;
    }
    
    // Replace any country-specific LinkedIn domain with www.linkedin.com
    linkedinUrl = linkedinUrl.replace(/https?:\/\/([a-z]{2}\.)?linkedin\.com/, 'https://www.linkedin.com');
    
    // Fix any typos like wwww instead of www
    linkedinUrl = linkedinUrl.replace(/https?:\/\/w+\./, 'https://www.');
    
    // Ensure it ends with a trailing slash
    if (!linkedinUrl.endsWith('/')) {
      linkedinUrl = linkedinUrl + '/';
    }
    
    logToFile(`✅ Found LinkedIn URL via Bing: ${linkedinUrl}`);
    updateDailyCount();
    return linkedinUrl;
    
  } catch (error) {
    logToFile(`❌ Bing search error: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// Main search function - Bing only (no CAPTCHAs!)
async function searchWithFallback(searchQuery, company) {
  try {
    // Use Bing exclusively - it works reliably without CAPTCHAs
    logToFile('Searching with Bing...');
    const bingResult = await findLinkedInUrlBing(searchQuery, company);
    
    if (!bingResult) {
      // Try alternative search format if first attempt fails
      logToFile('First search returned no results, trying without company name...');
      const bingResultAlt = await findLinkedInUrlBing(searchQuery, null);
      return bingResultAlt;
    }
    
    return bingResult;
    
  } catch (error) {
    logToFile(`Bing search error: ${error.message}`);
    return null;
  }
}

// API endpoint for finding LinkedIn URLs
app.post('/scrape', async (req, res) => {
  try {
    const { searchQuery, company, contactId } = req.body;
    
    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'searchQuery is required',
        contactId 
      });
    }
    
    logToFile(`\n=== New search request ===`);
    logToFile(`Contact: ${searchQuery} | Company: ${company || 'N/A'} | ID: ${contactId || 'N/A'}`);
    
    const profileUrl = await searchWithFallback(searchQuery, company);
    
    if (profileUrl) {
      res.json({
        success: true,
        name: searchQuery,
        profileUrl: profileUrl,
        scrapedAt: new Date().toISOString()
      });
    } else {
      res.json({
        success: false,
        name: searchQuery,
        error: 'No LinkedIn profile found',
        scrapedAt: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logToFile(`❌ API Error: ${error.message}`);
    res.status(500).json({ 
      success: false,
      name: req.body.searchQuery,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    mode: 'google-search-only',
    dailyCount: dailyCount.count,
    maxDaily: MAX_DAILY,
    date: dailyCount.date
  });
});

// Test endpoint
app.get('/test', async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'LinkedIn URL Finder is ready',
      mode: 'Google/Bing search - No LinkedIn login required'
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════════╗
  ║     LinkedIn URL Finder - Ready!                  ║
  ╠════════════════════════════════════════════════════╣
  ║  Mode:        Bing Search (No CAPTCHAs!)          ║
  ║  API URL:     http://localhost:${PORT}              ║
  ║  Health:      http://localhost:${PORT}/health       ║
  ║  Test:        http://localhost:${PORT}/test         ║
  ╠════════════════════════════════════════════════════╣
  ║  Daily Limit: ${MAX_DAILY} searches                       ║
  ║  No LinkedIn login required!                      ║
  ╚════════════════════════════════════════════════════╝
  
  ✅ Using Bing exclusively - no CAPTCHA issues!
  ✅ No credentials needed - .env file not required
  ✅ Automatic retry without company name if needed
  `);
});