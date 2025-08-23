#!/bin/bash

# Script to set up remote repository for ConnectX-Mobile
# Replace YOUR_REPO_URL with the actual GitHub repository URL

echo "Setting up remote repository for ConnectX-Mobile..."

# Check if repository URL is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <repository-url>"
    echo "Example: $0 git@github.com:Dextron04/ConnectX-Mobile.git"
    exit 1
fi

REPO_URL=$1

echo "Repository URL: $REPO_URL"

# Add remote origin
git remote add origin "$REPO_URL"

# Verify remote was added
echo "Remote repositories:"
git remote -v

# Push to main branch
echo "Pushing to remote repository..."
git push -u origin main

echo "✅ Successfully pushed ConnectX-Mobile to new repository!"
echo "🔗 Repository URL: $REPO_URL"
echo "📱 Your React Native wrapper is now available on GitHub!"