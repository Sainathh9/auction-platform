import re
import os

files = [
    'backend/src/server.js',
    'backend/src/consumer.js',
    'frontend/src/pages/AuctionDetail.jsx',
    'frontend/src/hooks/useWebSocket.js',
    'frontend/src/lib/api.js'
]

# Regex for emojis (basic approach)
emoji_pattern = re.compile(
    "["
    u"\U0001F600-\U0001F64F"  # emoticons
    u"\U0001F300-\U0001F5FF"  # symbols & pictographs
    u"\U0001F680-\U0001F6FF"  # transport & map symbols
    u"\U0001F1E0-\U0001F1FF"  # flags (iOS)
    u"\U00002702-\U000027B0"
    u"\U000024C2-\U0001F251"
    u"🚀⏱🔥🔒⚡💥💡🚨🛠"
    "]+", flags=re.UNICODE)

replacements = {
    '// 1. CORE DEPENDENCIES': '// Core Dependencies',
    '// 2. CONFIGURATION': '// Configuration',
    '// 3. RUNTIME SCHEMAS & LUA TRANSACTIONS': '// Runtime Schemas and Redis Lua Scripts',
    '// 4. SEEDING ROUTE': '// Seeding Route',
    '// 5. REDIS PUB/SUB SYSTEM INDEPENDENT NODE MULTIPLEXING': '// Redis Pub/Sub Configuration for Multi-Node Support',
    '// 6. WEBSOCKET PIPELINE WITH IN-MEMORY FIFO BUFFER QUEUE': '// WebSocket Event Pipeline',
    '// ANTI-SNIPING LOGIC:': '// Anti-Sniping Extension Logic',
    '// --- ANTI-SNIPING EXTENSION LOGIC ---': '// Process auction extensions for bids placed near expiration.',
    '// REDIS CLIENT INITIALIZATION WITH ENV CONFIGS': '// Redis Client Initialization',
    '// KAFKA BROKER INITIALIZATION': '// Kafka Producer Initialization',
    '// JWT AUTHORIZATION MIDDLEWARE FOR PROTECTED API ENDPOINTS': '// JWT Authorization Middleware',
    '// PROMETHEUS SCRAPING ROUTE': '// Prometheus Metrics Route',
    '// DATABASE INITIALIZATION & AUTOMATIC CATALOG SEEDING': '// Database Initialization and Seeding',
    '// AUTHENTICATION ENDPOINTS (JWT, bcrypt, Google OAuth)': '// Authentication Endpoints'
}

for file_path in files:
    if not os.path.exists(file_path):
        continue
        
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Remove emojis
    content = emoji_pattern.sub('', content)
    
    # Replace specific headers
    for old, new in replacements.items():
        content = content.replace(old, new)
        
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

print("Scrubbing complete.")
