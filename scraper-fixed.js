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

// Helper function to calculate string similarity (Levenshtein distance)
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  return (maxLen - distance) / maxLen; // Return similarity score 0-1
}

// Helper function to verify if profile name matches search query
function verifyNameMatch(searchName, profileText, company) {
  // Clean and normalize names for comparison
  const cleanName = searchName.toLowerCase().replace(/[^a-z\s\-]/g, '').trim();
  const cleanProfile = profileText.toLowerCase().replace(/[^a-z\s\-]/g, '').trim();
  
  // Split into parts for flexible matching
  const nameParts = cleanName.split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  
  // Log for debugging
  logToFile(`Name verification - Searching for: "${searchName}" (Company: ${company || 'N/A'})`);
  logToFile(`Found profile/URL: "${profileText}"`);
  
  // Extract profile ID from LinkedIn URLs
  let profileId = cleanProfile;
  if (cleanProfile.includes('linkedin.com/in/')) {
    const match = cleanProfile.match(/linkedin\.com\/in\/([^\/\?]+)/);
    if (match) profileId = match[1];
  }
  
  // Remove trailing hex/numeric IDs (like -a812ba194 or -22687b99)
  const cleanedProfileId = profileId.replace(/\-[a-f0-9]{6,}$/i, '').replace(/\-\d{6,}$/i, '');
  
  // Split profile ID into parts
  const profileParts = cleanedProfileId.split('-').filter(p => p.length > 0);
  
  logToFile(`Profile ID parts: [${profileParts.join(', ')}]`);
  logToFile(`Name parts: [${nameParts.join(', ')}]`);
  
  // STRATEGY 1: Check if first name matches
  const firstNameInProfile = profileParts.some(part => 
    part === firstName || 
    (firstName.length > 2 && part.startsWith(firstName.substring(0, 3)))
  );
  
  if (!firstNameInProfile) {
    logToFile(`❌ First name "${firstName}" not found in profile`);
    return false;
  }
  
  // STRATEGY 2: For multi-part names, verify last name or abbreviation
  if (nameParts.length > 1 && lastName) {
    // Check for exact last name match
    const exactLastNameMatch = profileParts.some(part => part === lastName);
    
    // Check for last name initial (e.g., "s" for "schalkwijk")
    const lastInitialMatch = profileParts.some(part => 
      part.length === 1 && part === lastName[0]
    );
    
    // Check for similar last names (80% similarity threshold)
    const similarLastName = profileParts.some(part => {
      if (part.length < 2) return false;
      const similarity = calculateSimilarity(part, lastName);
      return similarity > 0.8;
    });
    
    // Special case: Check if the profile has a completely different last name
    const profileLastPart = profileParts[profileParts.length - 1];
    if (profileLastPart && profileLastPart.length > 2) {
      // If it's clearly a different last name (not an abbreviation or partial match)
      const similarity = calculateSimilarity(profileLastPart, lastName);
      if (similarity < 0.3 && !lastInitialMatch) {
        logToFile(`❌ Different last name detected: "${profileLastPart}" vs "${lastName}" (similarity: ${similarity.toFixed(2)})`);
        return false;
      }
    }
    
    // Accept if we have a reasonable match
    if (exactLastNameMatch || lastInitialMatch || similarLastName) {
      logToFile(`✅ Name verification passed`);
      return true;
    }
    
    // STRATEGY 3: For Dutch/German names with prefixes, check without them
    const prefixes = ['van', 'de', 'der', 'den', 'von', 'zu', 'ter', 'ten'];
    const nameWithoutPrefixes = nameParts.filter(p => !prefixes.includes(p));
    const profileWithoutPrefixes = profileParts.filter(p => !prefixes.includes(p));
    
    if (nameWithoutPrefixes.length > 1 && profileWithoutPrefixes.length > 0) {
      const coreLastName = nameWithoutPrefixes[nameWithoutPrefixes.length - 1];
      const matchesCore = profileWithoutPrefixes.some(part => 
        part === coreLastName || calculateSimilarity(part, coreLastName) > 0.8
      );
      
      if (matchesCore) {
        logToFile(`✅ Core name match (without prefixes)`);
        return true;
      }
    }
    
    // STRATEGY 4: Company verification for edge cases
    if (company && cleanProfile.includes(company.toLowerCase().substring(0, 5))) {
      logToFile(`⚠️ Weak match, but company matches - accepting with caution`);
      return true;
    }
    
    logToFile(`❌ Insufficient name match for multi-part name`);
    return false;
  }
  
  // For single names (just first name), be very cautious
  // Single first names are too ambiguous - many people share same first name
  logToFile(`⚠️ Warning: Only first name provided - high risk of wrong match`);
  
  // For single names, require stronger verification
  if (profileParts.length === 1 && profileParts[0] === firstName) {
    // Profile is also just first name (rare)
    logToFile(`✅ Single name profile match`);
    return true;
  }
  
  // If profile has multiple parts but we only have first name, it's risky
  if (profileParts.length > 1) {
    logToFile(`❌ Cannot verify: Have only first name "${firstName}" but profile is "${profileParts.join('-')}"`);
    return false;
  }
  
  logToFile(`❌ Single name insufficient for verification`);
  return false;
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
    
    // Collect and verify ALL LinkedIn profiles, then pick the best match
    let linkedinUrl = null;
    const candidateProfiles = [];
    
    try {
      // Collect ALL LinkedIn profile URLs from the search results
      const links = await page.$$('a');
      for (const link of links) {
        const href = await link.evaluate(el => el.href);
        const text = await link.evaluate(el => el.textContent || '');
        
        // Check if this is a LinkedIn profile URL
        if (href && (href.includes('linkedin.com/in/') || href.includes('bing.com/ck'))) {
          let profileUrl = null;
          let profileId = null;
          
          // Direct LinkedIn URL
          if (href.includes('linkedin.com/in/')) {
            profileUrl = href;
            const match = href.match(/linkedin\.com\/in\/([^\/\?]+)/);
            if (match) profileId = match[1];
          }
          
          // Bing redirect with encoded LinkedIn URL
          else if (href.includes('bing.com/ck')) {
            // Try URL decoding
            if (href.includes('linkedin.com%2Fin%2F')) {
              const decoded = decodeURIComponent(href);
              const match = decoded.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
              if (match) {
                profileId = match[1];
                profileUrl = `https://www.linkedin.com/in/${profileId}`;
              }
            }
            
            // Try base64 decoding
            if (!profileUrl) {
              const urlMatch = href.match(/u=a1([^&]+)/);
              if (urlMatch) {
                try {
                  const decoded = atob(urlMatch[1]);
                  if (decoded.includes('linkedin.com/in/')) {
                    const match = decoded.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
                    if (match) {
                      profileId = match[1];
                      profileUrl = `https://www.linkedin.com/in/${profileId}`;
                    }
                  }
                } catch (e) {
                  // Base64 decode failed, continue
                }
              }
            }
          }
          
          // If we extracted a profile, add it to candidates
          if (profileUrl && profileId) {
            candidateProfiles.push({
              url: profileUrl,
              profileId: profileId,
              text: text
            });
            logToFile(`Found candidate profile: ${profileId}`);
          }
        }
      }
      
      // Now verify ALL candidates and pick the best match
      logToFile(`Found ${candidateProfiles.length} LinkedIn profiles to verify`);
      
      let bestMatch = null;
      let bestScore = 0;
      
      for (const candidate of candidateProfiles) {
        // Verify this profile
        const isValid = verifyNameMatch(searchQuery, candidate.profileId, company) || 
                       verifyNameMatch(searchQuery, candidate.text, company);
        
        if (isValid) {
          // Calculate a match score based on how well it matches
          let score = 0;
          const searchLower = searchQuery.toLowerCase();
          const profileLower = candidate.profileId.toLowerCase();
          
          // Full exact match gets highest score
          if (profileLower === searchLower.replace(/\s+/g, '-')) {
            score = 100;
          }
          // Contains all parts of the name
          else if (searchLower.split(/\s+/).every(part => profileLower.includes(part))) {
            score = 80;
          }
          // Abbreviated match (e.g., "john-d" for "John Doe")
          else if (searchLower.split(/\s+/).length > 1) {
            const parts = searchLower.split(/\s+/);
            const firstInitial = parts[0];
            const lastInitial = parts[parts.length - 1][0];
            if (profileLower.includes(firstInitial) && profileLower.includes(lastInitial)) {
              score = 60;
            }
          }
          // Basic first name match
          else {
            score = 40;
          }
          
          logToFile(`✅ Valid profile "${candidate.profileId}" with score: ${score}`);
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
          }
        } else {
          logToFile(`❌ Invalid profile "${candidate.profileId}" - doesn't match search`);
        }
      }
      
      // Use the best matching profile
      if (bestMatch) {
        linkedinUrl = bestMatch.url;
        logToFile(`Selected best match: ${bestMatch.profileId} (score: ${bestScore})`);
      } else {
        logToFile(`No valid LinkedIn profiles found among ${candidateProfiles.length} candidates`);
      }
      
    } catch (error) {
      logToFile(`Error during profile extraction: ${error.message}`);
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
                // Verify the name matches before accepting this result
                if (!verifyNameMatch(searchQuery, text, company)) {
                  logToFile(`⚠️ Skipping profile - name mismatch: "${text}" doesn't match "${searchQuery}"`);
                  continue; // Skip this result
                }
                
                logToFile(`✅ Name verified: "${text}" matches "${searchQuery}"`);
                
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
    const { searchQuery, company, contactId, email } = req.body;
    
    // Clean up input data - remove extra spaces and trim
    let cleanedSearchQuery = searchQuery ? searchQuery.replace(/\s+/g, ' ').trim() : '';
    const cleanedCompany = company ? company.replace(/\s+/g, ' ').trim() : '';
    
    // If we have an email and the search query seems incomplete (only first name), try to enhance it
    if (email && cleanedSearchQuery && !cleanedSearchQuery.includes(' ')) {
      // Extract name from email (e.g., cees.vandehaar@wur.nl -> Cees van de Haar)
      const emailParts = email.toLowerCase().split('@')[0];
      
      // Handle different email formats
      if (emailParts.includes('.')) {
        // Format: firstname.lastname or firstname.middlename.lastname
        const nameParts = emailParts.split('.');
        
        // Special handling for Dutch names with "van", "de", "den", etc.
        const enhancedName = nameParts.map(part => {
          // Handle "vandehaar" -> "van de haar"
          if (part.startsWith('vande')) {
            return 'van de ' + part.substring(5);
          } else if (part.startsWith('vander')) {
            return 'van der ' + part.substring(6);
          } else if (part.startsWith('van')) {
            return 'van ' + part.substring(3);
          } else if (part.startsWith('de')) {
            return 'de ' + part.substring(2);
          }
          return part;
        }).join(' ');
        
        // Capitalize properly
        const capitalizedName = enhancedName.split(' ').map(word => {
          if (['van', 'de', 'der', 'den', 'het', 'ter'].includes(word)) {
            return word; // Keep these lowercase
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
        
        logToFile(`Enhanced search query from email: "${cleanedSearchQuery}" -> "${capitalizedName}"`);
        
        // Only use the enhanced name if it contains the original first name
        if (capitalizedName.toLowerCase().includes(cleanedSearchQuery.toLowerCase())) {
          cleanedSearchQuery = capitalizedName;
        }
      }
    }
    
    if (!cleanedSearchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'searchQuery is required',
        contactId 
      });
    }
    
    logToFile(`\n=== New search request ===`);
    logToFile(`Contact: ${cleanedSearchQuery} | Company: ${cleanedCompany || 'N/A'} | ID: ${contactId || 'N/A'}`);
    
    const profileUrl = await searchWithFallback(cleanedSearchQuery, cleanedCompany);
    
    if (profileUrl) {
      res.json({
        success: true,
        name: cleanedSearchQuery,
        profileUrl: profileUrl,
        contactId: contactId,
        scrapedAt: new Date().toISOString()
      });
    } else {
      // Return success: false so n8n can handle this case
      logToFile(`⚠️ No verified LinkedIn profile found for: ${cleanedSearchQuery}`);
      res.json({
        success: false,
        name: cleanedSearchQuery,
        contactId: contactId,
        error: 'No verified LinkedIn profile found',
        reason: 'Could not find or verify a matching LinkedIn profile',
        scrapedAt: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logToFile(`❌ API Error: ${error.message}`);
    res.status(500).json({ 
      success: false,
      name: req.body.searchQuery ? req.body.searchQuery.replace(/\s+/g, ' ').trim() : '',
      contactId: req.body.contactId,
      error: error.message,
      reason: 'API error occurred during search'
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