FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install global packages permanently
# - pm2: Process manager
# - openclaw: The agent (Stable version)
RUN npm install -g pm2 openclaw@latest

# Install Playwright dependencies globally (so they are baked in)
RUN npx playwright install --with-deps

# Create openclaw config directory and set permissions
RUN mkdir -p /home/node/.openclaw && chown -R node:node /home/node/.openclaw

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set the default user
USER node
ENV HOME=/home/node

# Explicitly run with bash to avoid Node.js module loading errors
ENTRYPOINT ["/bin/bash", "/usr/local/bin/entrypoint.sh"]
