#!/bin/bash
# set -e  <-- Disabled to prevent container exit on intermediate errors

echo "Starting Dev Container Entrypoint..."

# Ensure node_modules permissions
if [ -d "/workspaces/candy_boost_planner/node_modules" ]; then
    echo "Checking node_modules permissions..."
    if [ "$(stat -c '%U' /workspaces/candy_boost_planner/node_modules)" != "node" ]; then
        echo "Updating ownership of node_modules..."
        sudo chown -R node:node /workspaces/candy_boost_planner/node_modules
    fi
fi

# OpenClaw Configuration
# Ensure config directory permissions
if [ -d "/home/node/.openclaw" ]; then
    echo "Ensuring permissions for .openclaw..."
    sudo chown -R node:node /home/node/.openclaw
fi

# Go to workspace
cd /workspaces/candy_boost_planner

echo "Starting OpenClaw via PM2..."
pm2 delete openclaw 2>/dev/null || true
pm2 start openclaw --name openclaw -- gateway run || echo "Failed to start openclaw via PM2"
pm2 save

echo "Entrypoint logic finished."
echo "Tailing logs to keep container alive..."

# Keep container alive unconditionally
pm2 logs || { echo "PM2 logs failed, fallback to infinite sleep..."; tail -f /dev/null; }
