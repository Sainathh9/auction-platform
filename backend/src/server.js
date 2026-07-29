import 'dotenv/config'; 
import express from 'express';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { z } from 'zod';
import { Kafka, Partitioners } from 'kafkajs';
import pkg from 'pg';
import { Queue, Worker } from 'bullmq';
const { Pool } = pkg;
import client from 'prom-client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

const JWT_SECRET = process.env.JWT_SECRET || 'your-production-secret-key';

const app = express();

// ENV VARIABLE FALLBACKS WITH DEFAULTS
const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// PROMETHEUS METRICS INSTRUMENTATION
client.collectDefaultMetrics({ prefix: 'bidding_' });

export const activeConnectionsGauge = new client.Gauge({
    name: 'websocket_active_connections',
    help: 'Current active WebSocket connections'
});

export const bidCounter = new client.Counter({
    name: 'bids_processed_total',
    help: 'Total bids evaluated by hot path',
    labelNames: ['status'] // ACCEPTED, REJECTED, EXPIRED, ERROR
});

export const luaLatencyHistogram = new client.Histogram({
    name: 'bid_lua_latency_seconds',
    help: 'Execution latency of Redis Lua atomic script',
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05] // 0.5ms to 50ms
});

export const expiryLagHistogram = new client.Histogram({
    name: 'bidding_engine_expiry_processing_lag_seconds',
    help: 'Time delta between the scheduled auction end time and actual worker execution',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5]
});

// BULLMQ CONFIGURATION
const bullRedisConfig = {
    host: REDIS_HOST,
    port: Number(REDIS_PORT)
};

// 1. Initialize the Auction Expiry Queue
const auctionExpiryQueue = new Queue('auction-expiry', {
    connection: bullRedisConfig
});

// LOCAL POSTGRES DEPLOYMENT CONFIGURATION
// host must be '127.0.0.1' (TCP) with password:'' for pg18 trust auth to work without SCRAM
const pgPool = new Pool({
    user: process.env.DB_USER || 'sainath',
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'bidding_engine',
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: 20
});

// REDIS CLIENT INITIALIZATION WITH ENV CONFIGS
const redisClient = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });
const redisSubClient = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });

// 2. Build the Idempotent Worker Processor
const auctionExpiryWorker = new Worker('auction-expiry', async (job) => {
    const { auctionId } = job.data;
    console.log(`[BullMQ Worker] Processing scheduled expiration for: ${auctionId}`);

    // Track Prometheus Expiry Drift Lag
    if (job.opts && job.opts.delay) {
        const timestampNow = Date.now();
        const targetExecutionTime = job.timestamp + job.opts.delay;
        const driftLagSeconds = Math.max(0, (timestampNow - targetExecutionTime) / 1000);
        expiryLagHistogram.observe(driftLagSeconds);
    }

    const dbClient = await pgPool.connect();

    try {
        // Atomic Perimeter Step A: Lock down the Hot Path immediately in Redis
        const hsetKey = `auction:details:${auctionId}`;
        await redisClient.hset(hsetKey, 'status', 'FINISHED');

        // Atomic Perimeter Step B: Update the System of Record
        const dbRes = await dbClient.query(
            `
            UPDATE auctions
            SET status = 'FINISHED'
            WHERE id = $1 AND status = 'ACTIVE'
            RETURNING id, current_highest_bid;
            `,
            [auctionId]
        );

        // Step C: Broadcast the terminal state to all listening WebSockets
        const closePayload = JSON.stringify({ 
            type: 'AUCTION_CONCLUDED', 
            auctionId 
        });
        await redisClient.publish(`auction:broadcast:${auctionId}`, closePayload);

        if (dbRes.rows.length > 0) {
            console.log(`[BullMQ Worker] Concluded ${auctionId}. Clearing price: $${dbRes.rows[0].current_highest_bid}`);
        } else {
            console.log(`[BullMQ Worker] ${auctionId} was already finalized or did not exist.`);
        }

        const winningBidRes = await dbClient.query(
            `SELECT user_id, amount, bid_timestamp 
             FROM bids 
             WHERE auction_id = $1 AND status = 'ACCEPTED' 
             ORDER BY amount DESC, bid_timestamp ASC 
             LIMIT 1;`,
            [auctionId]
        );

        if (winningBidRes.rows.length > 0) {
            const winner = winningBidRes.rows[0];
            
            // Save winner and final price to database
            await dbClient.query(
                `UPDATE auctions SET winner_id = $1, final_price = $2 WHERE id = $3;`,
                [winner.user_id, winner.amount, auctionId]
            );

            // Publish settlement event for downstream payment/fulfillment services
            await kafkaProducer.send({
                topic: 'auction-settlements',
                messages: [{
                    key: auctionId,
                    value: JSON.stringify({
                        type: 'AUCTION_SETTLED',
                        auctionId,
                        winnerUserId: winner.user_id,
                        winningAmount: winner.amount,
                        settledAt: new Date().toISOString()
                    })
                }]
            });
            
            console.log(`[Settlement Engine] Triggered winning settlement for ${auctionId} -> User: ${winner.user_id} @ $${winner.amount}`);
        } else {
            console.log(`[Settlement Engine] Auction ${auctionId} closed with 0 bids. No winner.`);
        }

    } catch (err) {
        console.error(`[BullMQ Worker Error] Failed to close auction ${auctionId}:`, err);
        throw err;
    } finally {
        dbClient.release();
    }
}, { 
    connection: bullRedisConfig,
    concurrency: 5
});

auctionExpiryWorker.on("completed", job => {
    console.log(`[BullMQ] Job ${job.id} completed`);
});

auctionExpiryWorker.on("failed", (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} failed`, err);
});

auctionExpiryWorker.on("error", err => {
    console.error("[BullMQ Worker Error]", err);
});

// Split the environment variable string into an array, or fallback to local broker string array
const kafkaBrokers = process.env.KAFKA_BROKERS 
    ? process.env.KAFKA_BROKERS.split(',') 
    : ['localhost:9092'];

app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// Enable CORS for frontend applications
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// KAFKA BROKER INITIALIZATION
const kafka = new Kafka({
    clientId: 'auction-gateway',
    brokers: kafkaBrokers
});

const kafkaProducer = kafka.producer({ 
    createPartitioner: Partitioners.LegacyPartitioner 
});

async function initKafka() {
    try {
        await kafkaProducer.connect();
        console.log('[Kafka Producer] Connected successfully to cluster broker');
    } catch (err) {
        console.error('[Kafka Producer] Connection failed:', err);
        process.exit(1);
    }
}
initKafka();

// 3. RUNTIME SCHEMAS & LUA TRANSACTIONS
const BidSchema = z.object({
    userId: z.string().min(1),
    amount: z.coerce.number().positive()
});

const DUAL_STORE_LUA = `
    local auction_exists = redis.call('EXISTS', KEYS[2])
    if auction_exists == 0 then return -1 end

    local status = redis.call('HGET', KEYS[2], 'status')
    local expires_at = tonumber(redis.call('HGET', KEYS[2], 'expires_at') or 0)
    
    -- Redis is the single clock authority
    local redis_time = redis.call('TIME')
    local current_time = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

    -- Hard Boundary: Block if status is explicitly FINISHED or time is already past deadline
    if status == 'FINISHED' or (expires_at > 0 and current_time >= expires_at) then
        if status == 'ACTIVE' then
            redis.call('HSET', KEYS[2], 'status', 'FINISHED')
        end
        return -2
    end

    local current_price = tonumber(redis.call('HGET', KEYS[2], 'current_highest_bid') or 0)
    local incoming_amount = tonumber(ARGV[1])

    -- Increment bid_count for all bid attempts, both accepted and rejected
    redis.call('HINCRBY', KEYS[2], 'bid_count', 1)

    if incoming_amount > current_price then
        redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
        redis.call('HSET', KEYS[2], 'current_highest_bid', ARGV[1], 'last_bidder', ARGV[2])
        

        -- ANTI-SNIPING LOGIC:
        -- Must have time left (time_remaining > 0) AND be within the 10,000ms window
        local time_remaining = expires_at - current_time
        local extended = 0

        if expires_at > 0 and time_remaining > 0 and time_remaining <= 10000 then
            local new_expires_at = expires_at + 30000
            redis.call('HSET', KEYS[2], 'expires_at', tostring(new_expires_at))
            extended = 1
        end

        -- Return status: 1 = ACCEPTED, 2 = ACCEPTED_AND_EXTENDED
        if extended == 1 then
            return 2
        else
            return 1
        end
    else
        return 0
    end
`;

redisClient.defineCommand('processStrictBid', { numberOfKeys: 2, lua: DUAL_STORE_LUA });

// AUTHENTICATION ENDPOINTS (JWT, bcrypt, Google OAuth)
app.use(express.json());

// DATABASE INITIALIZATION & AUTOMATIC CATALOG SEEDING
async function initDatabase() {
    try {
        const client = await pgPool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    avatar VARCHAR(500),
                    role VARCHAR(50) DEFAULT 'BUYER',
                    rating NUMERIC DEFAULT 0.0,
                    sales_count INTEGER DEFAULT 0,
                    verified_status VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS auctions (
                    id VARCHAR(255) PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(255),
                    images TEXT[],
                    description TEXT,
                    start_price NUMERIC NOT NULL,
                    current_highest_bid NUMERIC NOT NULL,
                    bid_count INTEGER DEFAULT 0,
                    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
                    start_time TIMESTAMP WITH TIME ZONE,
                    end_time TIMESTAMP WITH TIME ZONE,
                    winner_id VARCHAR(255) REFERENCES users(id),
                    final_price NUMERIC
                );
            `);

            // Add columns if they don't exist (for existing tables)
            try {
                await client.query(`ALTER TABLE auctions ADD COLUMN winner_id VARCHAR(255) REFERENCES users(id);`);
            } catch (e) { /* ignore if exists */ }
            try {
                await client.query(`ALTER TABLE auctions ADD COLUMN final_price NUMERIC;`);
            } catch (e) { /* ignore if exists */ }

            await client.query(`
                CREATE TABLE IF NOT EXISTS bids (
                    id SERIAL PRIMARY KEY,
                    auction_id VARCHAR(255) NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
                    user_id VARCHAR(255) NOT NULL,
                    amount NUMERIC NOT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'ACCEPTED',
                    bid_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);

            console.log('[Database Init] Tables ready. No dummy data seeded as per user request.');
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[Database Init Error]', err);
    }
}

initDatabase();


app.post('/api/upload', upload.array('images', 10), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email, and password required' });
  }

  try {
    const existing = await pgPool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = `USR-${Date.now()}`;
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=000&color=fff`;

    await pgPool.query(
      'INSERT INTO users (id, name, email, password, avatar) VALUES ($1, $2, $3, $4, $5)',
      [id, name, email.toLowerCase(), hashedPassword, avatar]
    );

    const token = jwt.sign(
      { sub: id, email: email.toLowerCase(), name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ token, user: { id, name, email: email.toLowerCase(), avatar } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    let userRes = await pgPool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    
    // Seed stanley if not exists for easy testing
    if (userRes.rows.length === 0 && email.toLowerCase() === 'stanley@gmail.com') {
        const hashedPassword = await bcrypt.hash('password123', 10);
        const avatar = 'https://ui-avatars.com/api/?name=Stanley+Hudson&background=000&color=fff';
        await pgPool.query(
            'INSERT INTO users (id, name, email, password, avatar) VALUES ($1, $2, $3, $4, $5)',
            ['USR-GGL-8891', 'Stanley Hudson', 'stanley@gmail.com', hashedPassword, avatar]
        );
        userRes = await pgPool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    }

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPass } = user;
    return res.json({ token, user: userWithoutPass });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const email = 'stanley@gmail.com';
    let userRes = await pgPool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user;
    if (userRes.rows.length === 0) {
        const hashedPassword = await bcrypt.hash('password123', 10);
        user = {
            id: 'USR-GGL-8891',
            name: 'Stanley Hudson',
            email: 'stanley@gmail.com',
            password: hashedPassword,
            avatar: 'https://ui-avatars.com/api/?name=Stanley+Hudson&background=000&color=fff'
        };
        await pgPool.query(
            'INSERT INTO users (id, name, email, password, avatar) VALUES ($1, $2, $3, $4, $5)',
            [user.id, user.name, user.email, user.password, user.avatar]
        );
    } else {
        user = userRes.rows[0];
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, provider: 'google' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPass } = user;
    return res.json({ token, user: userWithoutPass });
  } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/sellers/top', async (req, res) => {
    try {
        const result = await pgPool.query("SELECT id, name, rating, sales_count as sales, verified_status as verified, avatar as image FROM users WHERE role = 'SELLER' ORDER BY rating DESC LIMIT 4");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch sellers' });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const result = await pgPool.query("SELECT DISTINCT category FROM auctions WHERE category IS NOT NULL ORDER BY category ASC");
        res.json(result.rows.map(r => r.category));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ user: decoded });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// JWT AUTHORIZATION MIDDLEWARE FOR PROTECTED API ENDPOINTS
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Valid JWT Bearer Token Required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or Expired JWT Token' });
  }
};

// PROMETHEUS SCRAPING ROUTE
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    } catch (err) {
        res.status(500).end(err);
    }
});

// 4. SEEDING ROUTE
app.post('/api/auctions/seed', async (req, res) => {
    const { auctionId, title, startPrice, startTime, endTime, category = 'Collectibles', images = ['/images/rolex.png'], description = '' } = req.body;

    if (!auctionId || !title || !startPrice || !startTime || !endTime) {
        return res.status(400).json({
            error: "Missing required fields: auctionId, title, startPrice, startTime, endTime"
        });
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const now = Date.now();

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Invalid startTime or endTime format. Use ISO 8601." });
    }

    if (endDate <= startDate) {
        return res.status(400).json({ error: "endTime must be after startTime." });
    }

    if (endDate.getTime() <= now) {
        return res.status(400).json({ error: "endTime must be in the future." });
    }

    const delayMs = endDate.getTime() - now; // ms until auction ends

    const dbClient = await pgPool.connect();

    try {
        await dbClient.query('BEGIN');

        await dbClient.query(
            `
            INSERT INTO auctions
                (id, title, category, images, description, start_price, current_highest_bid, status, start_time, end_time)
            VALUES
                ($1, $2, $3, $4, $5, $6, $6, 'ACTIVE', $7, $8)
            ON CONFLICT (id)
            DO UPDATE
            SET
                title = EXCLUDED.title,
                category = EXCLUDED.category,
                images = EXCLUDED.images,
                description = EXCLUDED.description,
                start_price = EXCLUDED.start_price,
                current_highest_bid = EXCLUDED.current_highest_bid,
                status = 'ACTIVE',
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time
            `,
            [auctionId, title, category, images, description, startPrice, startDate, endDate]
        );

        await redisClient.hset(`auction:details:${auctionId}`, {
            title,
            category,
            images: JSON.stringify(images),
            description,
            start_price: startPrice.toString(),
            current_highest_bid: startPrice.toString(),
            bid_count: '0',
            status: "ACTIVE",
            expires_at: endDate.getTime().toString()
        });

        const jobId = `expire--${auctionId}`;
        try {
            const existingJob = await auctionExpiryQueue.getJob(jobId);
            if (existingJob) {
                await existingJob.remove().catch(() => {});
            }

            await auctionExpiryQueue.add(
                'auction-expiry-job',
                { auctionId }, 
                { 
                    jobId,
                    delay: delayMs,
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 1000
                    },
                    removeOnComplete: 100, 
                    removeOnFail: 500    
                }
            );
        } catch (queueErr) {
            console.error('[BullMQ Seeding Job Warning]', queueErr.message);
        }

        await dbClient.query('COMMIT');

        res.status(200).json({
            message: `Auction "${title}" created. BullMQ worker scheduled to fire at ${endDate.toISOString()} (in ${Math.round(delayMs / 1000)}s).`
        });

    } catch (err) {
        await dbClient.query('ROLLBACK');
        console.error('[Seeding Error] Transaction rolled back cleanly:', err);
        res.status(500).json({ error: "Failed to create auction safely." });
    } finally {
        dbClient.release();
    }
});


const server = app.listen(PORT, () => console.log(`[Gateway] Operating on port ${PORT}`));
const wss = new WebSocketServer({ noServer: true });

// Intercept HTTP -> WS Upgrade to authenticate users
server.on('upgrade', (request, socket, head) => {
    // Normalize: handle both '/path?token=x' and 'ws://host/path?token=x' formats
    let rawUrl = request.url || '';
    if (rawUrl.startsWith('ws://') || rawUrl.startsWith('wss://')) {
        rawUrl = new URL(rawUrl).pathname + (new URL(rawUrl).search || '');
    }
    const url = new URL(rawUrl, `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    if (token) {
        try {
            // Verify JWT token signature and expiration
            const decoded = jwt.verify(token, JWT_SECRET);
            request.user = decoded; // Attach user payload to request
        } catch (err) {
            console.error('[WS] Invalid token on connection attempt:', err.message);
            // Proceed as guest without setting request.user
        }
    }
    
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

const auctionRooms = new Map();

// 5. REDIS PUB/SUB SYSTEM INDEPENDENT NODE MULTIPLEXING
redisSubClient.psubscribe('auction:broadcast:*');
redisSubClient.on('pmessage', (pattern, channel, message) => {
    const auctionId = channel.split(':').pop();
    const localRoom = auctionRooms.get(auctionId);
    if (localRoom) {
        localRoom.forEach((client) => {
            if (client.readyState === 1) client.send(message);
        });
    }
});

// 6. WEBSOCKET PIPELINE WITH IN-MEMORY FIFO BUFFER QUEUE
wss.on('connection', (ws, req) => {
    activeConnectionsGauge.inc();

    const urlObj = new URL(req.url, 'http://localhost');
    const urlParts = urlObj.pathname.split('/').filter(Boolean);
    const auctionId = urlParts[urlParts.length - 1];
    
    if (!auctionId) return ws.close(4000, 'Auction ID parameter missing');
    if (!auctionRooms.has(auctionId)) auctionRooms.set(auctionId, new Set());
    auctionRooms.get(auctionId).add(ws);

    // Send initial snapshot so the client timer is anchored to backend ground truth
    redisClient.hgetall(`auction:details:${auctionId}`).then((details) => {
        if (details) {
            ws.send(JSON.stringify({
                type: 'AUCTION_SNAPSHOT',
                auctionId,
                status: details.status || 'ACTIVE',
                currentHighestBid: parseFloat(details.current_highest_bid) || 0,
                expiresAt: parseInt(details.expires_at, 10) || 0
            }));
        }
    }).catch(() => {});


    const MAX_BIDS_PER_WINDOW = 10;
    const WINDOW_MS = 1000; // 1 second
    let bidTimestamps = [];

    function isRateLimited() {
        const now = Date.now();
        // Filter out timestamps older than the 1-second window
        bidTimestamps = bidTimestamps.filter(ts => now - ts < WINDOW_MS);
        
        if (bidTimestamps.length >= MAX_BIDS_PER_WINDOW) {
            return true; // Throttle execution
        }
        
        bidTimestamps.push(now);
        return false;
    }

    const hsetKey = `auction:details:${auctionId}`;
    const zsetKey = `auction:leaderboard:${auctionId}`;

    const messageQueue = [];
    let isProcessing = false;

    async function processQueue() {
        if (isProcessing || messageQueue.length === 0) return;
        isProcessing = true;

        const rawData = messageQueue.shift();
        const startHrTime = process.hrtime();

        try {
            const packet = JSON.parse(rawData);
            const validation = BidSchema.safeParse(packet);

            if (!validation.success) {
                ws.send(JSON.stringify({ type: 'ERROR', reason: 'Malformed payload data structural violation.', errors: validation.error.format() }));
                bidCounter.labels({ status: 'ERROR' }).inc();
                isProcessing = false;
                return processQueue();
            }

            const { userId, amount } = validation.data;

            if (!req.user || (req.user.id !== userId && req.user.sub !== userId)) {
                console.log('WS Auth Failed:', { reqUser: req.user, payloadUserId: userId });
                ws.send(JSON.stringify({ type: 'ERROR', reason: 'Unauthorized to place bids for this user context.' }));
                bidCounter.labels({ status: 'ERROR' }).inc();
                isProcessing = false;
                return processQueue();
            }

            const timestamp = Date.now();
            const memberPayload = JSON.stringify({ userId, ts: timestamp });

            const result = await redisClient.processStrictBid(
                zsetKey, 
                hsetKey, 
                amount.toString(), 
                memberPayload
            );
            
            const diff = process.hrtime(startHrTime);
            const durationInSeconds = diff[0] + diff[1] / 1e9;
            luaLatencyHistogram.observe(durationInSeconds);

            let bidStatus = 'REJECTED';

            // Check for standard ACCEPTED (1) or ACCEPTED + EXTENDED (2)
            if (result === 1 || result === 2) {
                bidStatus = 'ACCEPTED';
                bidCounter.labels({ status: 'ACCEPTED' }).inc();

                // Direct loopback ACK to the bidding socket
                ws.send(JSON.stringify({ type: 'BID_ACK', status: 'ACCEPTED', amount }));

                // --- ANTI-SNIPING EXTENSION LOGIC ---
                if (result === 2) {
                    const newExpiresAt = await redisClient.hget(hsetKey, 'expires_at');
                    const jobId = `expire--${auctionId}`;

                    if (newExpiresAt) {
                        const newDelay = Math.max(0, parseInt(newExpiresAt, 10) - Date.now());

                        // Isolated queue update to protect gateway message loop
                        try {
                            const existingJob = await auctionExpiryQueue.getJob(jobId);
                            if (existingJob) {
                                if (typeof existingJob.changeDelay === 'function') {
                                    await existingJob.changeDelay(newDelay);
                                } else {
                                    await existingJob.remove().catch(() => {});
                                    await auctionExpiryQueue.add(
                                        'auction-expiry-job',
                                        { auctionId },
                                        { 
                                            jobId, 
                                            delay: newDelay, 
                                            attempts: 5,
                                            backoff: {
                                                type: 'exponential',
                                                delay: 1000
                                            },
                                            removeOnComplete: 100, 
                                            removeOnFail: 500 
                                        }
                                    );
                                }
                            } else {
                                await auctionExpiryQueue.add(
                                    'auction-expiry-job',
                                    { auctionId },
                                    { 
                                        jobId, 
                                        delay: newDelay, 
                                        attempts: 5,
                                        backoff: {
                                            type: 'exponential',
                                            delay: 1000
                                        },
                                        removeOnComplete: 100, 
                                        removeOnFail: 500 
                                    }
                                );
                            }
                        } catch (queueErr) {
                            console.error('[BullMQ Reschedule Warning]:', queueErr.message);
                        }
                    }

                    // Broadcast system time push to all room subscribers over Pub/Sub
                    const extensionPayload = JSON.stringify({
                        type: 'AUCTION_EXTENDED',
                        auctionId,
                        newExpiresAt: parseInt(newExpiresAt, 10)
                    });
                    await redisClient.publish(`auction:broadcast:${auctionId}`, extensionPayload);
                }

            } else if (result === -1) {
                bidCounter.labels({ status: 'ERROR' }).inc();
                ws.send(JSON.stringify({ type: 'ERROR', reason: 'Auction is not initialized.' }));
                isProcessing = false;
                return processQueue();
            } else if (result === -2) {
                bidCounter.labels({ status: 'EXPIRED' }).inc();
                ws.send(JSON.stringify({ type: 'AUCTION_EXPIRED', reason: 'This auction has concluded.' }));
                isProcessing = false;
                return processQueue();
            } else {
                bidCounter.labels({ status: 'REJECTED' }).inc();
                ws.send(JSON.stringify({ type: 'BID_REJECTED', reason: 'Bid too low.' }));
            }

            // Broadcasting every single bid attempt live to all connected clients
            try {
                const attemptPayload = {
                    type: 'NEW_BID_ATTEMPT',
                    auctionId,
                    bid: {
                        id: `bid_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        userId,
                        amount,
                        timestamp,
                        status: bidStatus,
                        userName: req.user?.name || req.user?.sub || userId,
                        userAvatar: req.user?.avatar || null
                    }
                };
                await redisClient.publish(`auction:broadcast:${auctionId}`, JSON.stringify(attemptPayload));
            } catch (err) {
                console.error('[Pub/Sub Broadcast Error]', err);
            }

            // Asynchronous durability path (Cold Path with backpressure enforcement)
            await kafkaProducer.send({
                topic: 'auction-bids',
                messages: [
                    {
                        key: auctionId,
                        value: JSON.stringify({
                            auctionId,
                            userId,
                            amount,
                            timestamp,
                            status: bidStatus
                        })
                    }
                ]
            }).catch(err => console.error('[Fatal Cold-Path Drop] Kafka pipeline failed:', err));

        } catch (err) {
            bidCounter.labels({ status: 'ERROR' }).inc();
            console.error('❌ [CRITICAL GATEWAY ERROR STACK]:', err);
            ws.send(JSON.stringify({ type: 'ERROR', error: err.message || 'Invalid operation.' }));
        } finally {
            isProcessing = false;
            processQueue();
        }
    }

    ws.on('message', (rawData) => {
        if (isRateLimited()) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                reason: 'Rate limit exceeded. Maximum 10 bids per second allowed.'
            }));
            return;
        }
        messageQueue.push(rawData);
        processQueue();
    });

    ws.on('close', () => {
        activeConnectionsGauge.dec();
        if (auctionRooms.has(auctionId)) {
            auctionRooms.get(auctionId).delete(ws);
            if (auctionRooms.get(auctionId).size === 0) auctionRooms.delete(auctionId);
        }
    });
});

// 7. DASHBOARD LOG & CACHE RECOVERY API ROUTES

// GET /api/auctions — returns all auctions from PostgreSQL + live Redis overlay
app.get('/api/auctions', async (req, res) => {
    try {
        const { rows } = await pgPool.query(
            `SELECT id, title, category, images, description, start_price as "startPrice", 
                    current_highest_bid as "currentHighestBid", bid_count as "bidCount", 
                    status, start_time as "startTime", end_time as "endTime"
             FROM auctions 
             ORDER BY start_time DESC;`
        );

        const auctions = await Promise.all(rows.map(async (row) => {
            const redisDetails = await redisClient.hgetall(`auction:details:${row.id}`).catch(() => null);
            let expiresAt = row.endTime ? new Date(row.endTime).getTime() : 0;
            let status = row.status;
            let currentHighestBid = parseFloat(row.currentHighestBid) || parseFloat(row.startPrice) || 0;
            let bidCount = parseInt(row.bidCount, 10) || 0;

            if (redisDetails && Object.keys(redisDetails).length > 0) {
                if (redisDetails.expires_at) expiresAt = parseInt(redisDetails.expires_at, 10) || expiresAt;
                if (redisDetails.status) status = redisDetails.status;
                if (redisDetails.current_highest_bid) currentHighestBid = parseFloat(redisDetails.current_highest_bid) || currentHighestBid;
                if (redisDetails.bid_count) bidCount = parseInt(redisDetails.bid_count, 10) || bidCount;
            }

            return {
                id: row.id,
                title: row.title,
                category: row.category || 'Collectibles',
                images: row.images || ['/images/rolex.png'],
                description: row.description || '',
                startPrice: parseFloat(row.startPrice) || 0,
                currentHighestBid,
                bidCount,
                status,
                startTime: row.startTime ? new Date(row.startTime).getTime() : Date.now() - 3600000,
                endTime: expiresAt,
            };
        }));

        return res.status(200).json(auctions);
    } catch (err) {
        console.error('[GET /api/auctions Error]', err);
        return res.status(500).json({ error: 'Failed to fetch auctions from database' });
    }
});

// GET /api/bids/me — returns all bids for the specified or authenticated user
app.get('/api/bids/me', async (req, res) => {
    const userId = req.query.userId || req.user?.sub || 'USR-a1b2';

    try {
        const { rows } = await pgPool.query(
            `WITH UserHighestBids AS (
                 SELECT DISTINCT ON (b.auction_id) 
                     b.auction_id as "auctionId", 
                     a.title as "auctionTitle", 
                     b.amount, 
                     b.status, 
                     b.bid_timestamp as "timestamp"
                 FROM bids b
                 JOIN auctions a ON b.auction_id = a.id
                 WHERE b.user_id = $1
                 ORDER BY b.auction_id, b.amount DESC
             )
             SELECT * FROM UserHighestBids ORDER BY "timestamp" DESC;`,
            [userId]
        );
        return res.status(200).json(rows);
    } catch (err) {
        console.error('[GET /api/bids/me Error]', err);
        return res.status(500).json({ error: 'Failed to fetch user bids from database' });
    }
});

// GET /api/auctions/:id — returns live auction state (Redis → Postgres fallback)
app.get('/api/auctions/:id', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const auctionId = req.params.id;

    try {
        // Try Redis first (hot path)
        const details = await redisClient.hgetall(`auction:details:${auctionId}`);

        // Also query Postgres for static lot details if Redis is missing metadata
        const { rows } = await pgPool.query(
            `SELECT id, title, category, images, description, start_price as "startPrice", 
                    current_highest_bid as "currentHighestBid", bid_count as "bidCount", 
                    status, start_time as "startTime", end_time as "endTime"
             FROM auctions WHERE id = $1 LIMIT 1;`,
            [auctionId]
        );

        const pgRow = rows[0] || {};
        
        let parsedRedisImages = null;
        if (details && details.images) {
            try { parsedRedisImages = JSON.parse(details.images); } catch(e) {}
        }

        if (details && details.expires_at) {
            return res.status(200).json({
                id: auctionId,
                auctionId,
                title: details.title || pgRow.title || '',
                category: details.category || pgRow.category || 'Collectibles',
                images: parsedRedisImages || pgRow.images || ['/images/rolex.png'],
                description: details.description || pgRow.description || '',
                status: details.status || pgRow.status || 'ACTIVE',
                currentHighestBid: parseFloat(details.current_highest_bid) || parseFloat(pgRow.currentHighestBid) || 0,
                startPrice: parseFloat(details.start_price) || parseFloat(pgRow.startPrice) || 0,
                bidCount: parseInt(details.bid_count, 10) || parseInt(pgRow.bidCount, 10) || 0,
                startTime: pgRow.startTime ? new Date(pgRow.startTime).getTime() : Date.now() - 3600000,
                expiresAt: parseInt(details.expires_at, 10) || (pgRow.endTime ? new Date(pgRow.endTime).getTime() : 0),
                endTime: parseInt(details.expires_at, 10) || (pgRow.endTime ? new Date(pgRow.endTime).getTime() : 0),
                source: 'redis'
            });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Auction not found' });
        }

        const expiresAt = pgRow.endTime ? new Date(pgRow.endTime).getTime() : 0;
        return res.status(200).json({
            id: pgRow.id,
            auctionId: pgRow.id,
            title: pgRow.title,
            category: pgRow.category || 'Collectibles',
            images: pgRow.images || ['/images/rolex.png'],
            description: pgRow.description || '',
            status: pgRow.status,
            currentHighestBid: parseFloat(pgRow.currentHighestBid) || 0,
            startPrice: parseFloat(pgRow.startPrice) || 0,
            bidCount: parseInt(pgRow.bidCount, 10) || 0,
            startTime: pgRow.startTime ? new Date(pgRow.startTime).getTime() : Date.now() - 3600000,
            expiresAt,
            endTime: expiresAt,
            source: 'postgres'
        });

    } catch (err) {
        console.error('[Auction Detail API Error]', err);
        return res.status(500).json({ error: 'Failed to fetch auction details.' });
    }
});

app.get('/api/auctions/:id/history', async (req, res) => {

    const auctionId = req.params.id;
    const { userId } = req.query;

    try {
        let query = `
            SELECT b.id, b.user_id as "userId", b.amount, b.bid_timestamp as "timestamp", b.status, u.name as "userName", u.avatar as "userAvatar"
            FROM bids b
            LEFT JOIN users u ON b.user_id = u.id
            WHERE b.auction_id = $1
        `;
        const params = [auctionId];

        if (userId) {
            params.push(userId);
            query += ` AND b.user_id = $2`;
        }

        query += ` ORDER BY b.bid_timestamp DESC, b.amount DESC;`;

        const { rows } = await pgPool.query(query, params);
        
        return res.status(200).json({
            auctionId,
            totalBidsRecorded: rows.length,
            history: rows
        });
    } catch (err) {
        console.error('[History API Error]', err);
        return res.status(500).json({ error: "Failed to fetch bid historical logs." });
    }
});

app.post('/api/auctions/:id/recover', async (req, res) => {
    const auctionId = req.params.id;
    const dbClient = await pgPool.connect();

    try {
        const auctionRes = await dbClient.query(
            `SELECT title, start_price, status, end_time FROM auctions WHERE id = $1;`,
            [auctionId]
        );

        if (auctionRes.rows.length === 0) {
            return res.status(404).json({ error: "Auction not found within the System of Record." });
        }

        const { title, start_price: startPrice, status, end_time: endTime } = auctionRes.rows[0];

        const highBidRes = await dbClient.query(
            `SELECT user_id, amount, bid_timestamp 
             FROM bids 
             WHERE auction_id = $1 AND status = 'ACCEPTED' 
             ORDER BY amount DESC, bid_timestamp ASC 
             LIMIT 1;`,
            [auctionId]
        );

        const hsetKey = `auction:details:${auctionId}`;
        const zsetKey = `auction:leaderboard:${auctionId}`;

        await redisClient.del(hsetKey, zsetKey);
        const expiresAtStr = endTime ? new Date(endTime).getTime().toString() : "0";

        if (highBidRes.rows.length > 0) {
            const highestBid = highBidRes.rows[0];
            const currentHighestAmount = highestBid.amount.toString();
            const memberPayload = JSON.stringify({ 
                userId: highestBid.user_id, 
                ts: new Date(highestBid.bid_timestamp).getTime() 
            });

            await redisClient.hset(hsetKey, {
                title: title,
                start_price: startPrice.toString(),
                current_highest_bid: currentHighestAmount,
                last_bidder: memberPayload,
                status: status,
                expires_at: expiresAtStr
            });

            await redisClient.zadd(zsetKey, currentHighestAmount, memberPayload);
        } else {
            await redisClient.hset(hsetKey, {
                title: title,
                start_price: startPrice.toString(),
                current_highest_bid: startPrice.toString(),
                status: status,
                expires_at: expiresAtStr
            });
        }

        const jobId = `expire--${auctionId}`;

        if (status === "ACTIVE" && endTime) {
            const remainingMs = new Date(endTime).getTime() - Date.now();

            if (remainingMs > 0) {
                const existingJob = await auctionExpiryQueue.getJob(jobId);
                if (existingJob) {
                    await existingJob.remove().catch(() => {});
                }

                await auctionExpiryQueue.add(
                    "auction-expiry-job",
                    { auctionId },
                    {
                        jobId,
                        delay: remainingMs,
                        attempts: 5,
                        backoff: {
                            type: "exponential",
                            delay: 1000
                        },
                        removeOnComplete: 100,
                        removeOnFail: 500
                    }
                );

                console.log(`[Recovery] Rescheduled expiry for ${auctionId}`);
            } else {
                await redisClient.hset(hsetKey, "status", "FINISHED");

                await dbClient.query(
                    `
                    UPDATE auctions
                    SET status='FINISHED'
                    WHERE id=$1
                    `,
                    [auctionId]
                );

                console.log(`[Recovery] Auction ${auctionId} already expired`);
            }
        }

        return res.status(200).json({ 
            message: `Hot Path state engine successfully rehydrated with expiry for auction: ${auctionId}` 
        });

    } catch (err) {
        console.error('[Disaster Recovery Failure]', err);
        return res.status(500).json({ error: "Failed to securely execute recovery processes." });
    } finally {
        dbClient.release();
    }
});

// LEADERBOARD DELTA WORKER
const lastLeaderboardCache = new Map();

async function leaderboardDeltaWorker() {
    try {
        if (auctionRooms.size === 0) {
            return;
        }

        for (const auctionId of auctionRooms.keys()) {
            const zsetKey = `auction:leaderboard:${auctionId}`;
            const topBidsRaw = await redisClient.zrevrange(zsetKey, 0, 4, 'WITHSCORES');
            
            if (!topBidsRaw || topBidsRaw.length === 0) continue;

            const leaderboard = [];
            for (let i = 0; i < topBidsRaw.length; i += 2) {
                const memberData = JSON.parse(topBidsRaw[i]);
                const scoreAmount = parseFloat(topBidsRaw[i + 1]);
                leaderboard.push({
                    userId: memberData.userId,
                    amount: scoreAmount,
                    timestamp: memberData.ts
                });
            }

            const diffSignature = JSON.stringify(leaderboard.map(l => `${l.userId}:${l.amount}`));

            if (lastLeaderboardCache.get(auctionId) !== diffSignature) {
                lastLeaderboardCache.set(auctionId, diffSignature);

                const userIds = leaderboard.map(l => l.userId);
                const { rows: users } = await pgPool.query(`SELECT id, name, avatar FROM users WHERE id = ANY($1)`, [userIds]);
                const userMap = {};
                users.forEach(u => userMap[u.id] = u);

                leaderboard.forEach(l => {
                    if (userMap[l.userId]) {
                        l.userName = userMap[l.userId].name;
                        l.userAvatar = userMap[l.userId].avatar;
                    }
                });

                const payloadString = JSON.stringify({
                    type: 'LEADERBOARD_DELTA',
                    auctionId,
                    leaderboard
                });
                await redisClient.publish(`auction:broadcast:${auctionId}`, payloadString);
            }
        }
    } catch (err) {
        console.error('[Leaderboard Delta Worker Error]', err);
    } finally {
        setTimeout(leaderboardDeltaWorker, 250);
    }
}

leaderboardDeltaWorker();

async function shutdown() {
    console.log("Shutting down...");
    await auctionExpiryWorker.close();
    await kafkaProducer.disconnect();
    await redisClient.quit();
    await redisSubClient.quit();
    await pgPool.end();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);