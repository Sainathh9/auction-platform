import 'dotenv/config'; // <-- CRITICAL: Must be the very first line to load your .env file
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
    const { auctionId, title, startPrice, durationSeconds = 60 } = req.body;

    if (!auctionId || !title || !startPrice) {
        return res.status(400).json({
            error: "Missing auctionId, title, or startPrice"
        });
    }

    const dbClient = await pgPool.connect();

    try {
        await dbClient.query('BEGIN');

        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + durationSeconds * 1000);

        await dbClient.query(
            `
            INSERT INTO auctions
                (id, title, start_price, current_highest_bid, status, start_time, end_time)
            VALUES
                ($1, $2, $3, $3, 'ACTIVE', $4, $5)
            ON CONFLICT (id)
            DO UPDATE
            SET
                title = EXCLUDED.title,
                start_price = EXCLUDED.start_price,
                current_highest_bid = EXCLUDED.current_highest_bid,
                status = 'ACTIVE',
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time
            `,
            [auctionId, title, startPrice, startTime, endTime]
        );

        await redisClient.hset(`auction:details:${auctionId}`, {
            title,
            start_price: startPrice.toString(),
            current_highest_bid: startPrice.toString(),
            status: "ACTIVE",
            expires_at: endTime.getTime().toString()
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
                    delay: durationSeconds * 1000,
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
            message: `Auction created successfully. BullMQ worker scheduled for target execution in ${durationSeconds} seconds.`
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

    if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    try {
        // Verify JWT token signature and expiration
        const decoded = jwt.verify(token, JWT_SECRET);
        request.user = decoded; // Attach user payload to request
        
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } catch (err) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
    }
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
app.get('/api/auctions/:id/history', async (req, res) => {
    const auctionId = req.params.id;
    const { userId } = req.query;

    try {
        let query = `
            SELECT id, user_id as "userId", amount, bid_timestamp as "timestamp", status
            FROM bids 
            WHERE auction_id = $1
        `;
        const params = [auctionId];

        if (userId) {
            params.push(userId);
            query += ` AND user_id = $2`;
        }

        query += ` ORDER BY bid_timestamp DESC, amount DESC;`;

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

            const payloadString = JSON.stringify({
                type: 'LEADERBOARD_DELTA',
                auctionId,
                leaderboard
            });

            if (lastLeaderboardCache.get(auctionId) !== payloadString) {
                lastLeaderboardCache.set(auctionId, payloadString);
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