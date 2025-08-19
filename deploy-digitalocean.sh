#!/bin/bash

# DigitalOcean Ubuntu 22.04 Setup Script for LinkedIn URL Finder

echo "==================================="
echo "Setting up LinkedIn URL Finder"
echo "==================================="

# Update system
echo "1. Updating system packages..."
apt update && apt upgrade -y

# Install Node.js 18.x
echo "2. Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install required dependencies for Puppeteer
echo "3. Installing Puppeteer dependencies..."
apt install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils

# Install PM2 for process management
echo "4. Installing PM2..."
npm install -g pm2

# Create app directory
echo "5. Creating application directory..."
mkdir -p /opt/linkedin-url-finder
cd /opt/linkedin-url-finder

# Install Git
echo "6. Installing Git..."
apt install -y git

echo "==================================="
echo "Server setup complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Upload your code to /opt/linkedin-url-finder"
echo "2. Run: npm install"
echo "3. Start with PM2: pm2 start scraper.js --name linkedin-finder"
echo "4. Save PM2 config: pm2 save"
echo "5. Setup PM2 startup: pm2 startup"
echo ""
echo "Your server is ready for deployment!"