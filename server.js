import 'dotenv/config'; // <-- CRITICAL: Must be the very first line to load your .env file
import express from 'express';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { z } from 'zod';
import { Kafka, Partitioners } from 'kafkajs';
import pkg from 'pg';
import { Queue, Worker } from 'bullmq';
const { Pool } = pkg;


const app = express();

// ENV VARIABLE FALLBACKS WITH DEFAULTS
const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;


const bullRedisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379)
};

// 1. Initialize the Auction Expiry Queue
const auctionExpiryQueue = new Queue('auction-expiry', {
    connection: bullRedisConfig
});

// 2. Build the Idempotent Worker Processor
const auctionExpiryWorker = new Worker('auction-expiry', async (job) => {
    const { auctionId } = job.data;
    console.log(`[BullMQ Worker] Processing scheduled expiration for: ${auctionId}`);

    const dbClient = await pgPool.connect();

    try {
        // Atomic Perimeter Step A: Lock down the Hot Path immediately in Redis
        const hsetKey = `auction:details:${auctionId}`;
        
        // We set status to FINISHED. If it was already finished, this is harmless (idempotent)
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

    } catch (err) {
        console.error(`[BullMQ Worker Error] Failed to close auction ${auctionId}:`, err);
        throw err; // Retries according to BullMQ backoff policies
    } finally {
        dbClient.release();
    }
}, { 
    connection: bullRedisConfig,
    concurrency: 5 // Process up to 5 expiries simultaneously without event-loop lag
});




// FIX: Split the environment variable string into an array, or fallback to local broker string array
const kafkaBrokers = process.env.KAFKA_BROKERS 
    ? process.env.KAFKA_BROKERS.split(',') 
    : ['127.0.0.1:9092'];

app.use(express.json());

// LOCAL POSTGRES DEPLOYMENT CONFIGURATION
const pgPool = new Pool({
    user: process.env.DB_USER || 'sainath',
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'bidding_engine',
    password: process.env.DB_PASSWORD || '', 
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: 20
});

// REDIS CLIENT INITIALIZATION WITH ENV CONFIGS
const redisClient = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });
const redisSubClient = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });

// KAFKA BROKER INITIALIZATION (Fixed configuration parsing)
const kafka = new Kafka({
    clientId: 'auction-gateway',
    brokers: kafkaBrokers // <-- Passes the array instead of an undefined string pointer
});

// Use the standard legal Murmur2 partitioner for strict ordering by key
const kafkaProducer = kafka.producer({ 
    createPartitioner: Partitioners.LegacyPartitioner 
});

// Connect Kafka producer on app boot
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
    amount: z.number().positive()
});

const DUAL_STORE_LUA = `
    local auction_exists = redis.call('EXISTS', KEYS[2])
    if auction_exists == 0 then return -1 end

    local status = redis.call('HGET', KEYS[2], 'status')
    local expires_at = tonumber(redis.call('HGET', KEYS[2], 'expires_at') or 0)
    local current_time = tonumber(ARGV[3])

    -- Hard Boundary: Block if state is marked FINISHED or time window has closed
    if status == 'FINISHED' or (expires_at > 0 and current_time >= expires_at) then
        if status == 'ACTIVE' then
            redis.call('HSET', KEYS[2], 'status', 'FINISHED')
        end
        return -2 -- Code -2 explicitly means Auction Expired
    end

    local current_price = tonumber(redis.call('HGET', KEYS[2], 'current_highest_bid') or 0)
    local incoming_amount = tonumber(ARGV[1])

    if incoming_amount > current_price then
        redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
        redis.call('HSET', KEYS[2], 'current_highest_bid', ARGV[1], 'last_bidder', ARGV[2])
        return 1 -- ACCEPTED
    else
        return 0 -- REJECTED
    end
`;

redisClient.defineCommand('processStrictBid', { numberOfKeys: 2, lua: DUAL_STORE_LUA });

// 4. SEEDING ROUTE (Dual-Write Pattern: PostgreSQL First, then Redis Cache inside a true transaction)
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

        // 1. Write core record to PostgreSQL
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

        // 2. Warm the Redis Cache hot path
        await redisClient.hset(`auction:details:${auctionId}`, {
            title,
            start_price: startPrice.toString(),
            current_highest_bid: startPrice.toString(),
            status: "ACTIVE",
            expires_at: endTime.getTime().toString()
        });

        // 3. SCHEDULE THE DELAYED JOB IN BULLMQ
        // The job remains hidden inside Redis until the precise delay millisecond is crossed
        await auctionExpiryQueue.add(
            `expire:${auctionId}`, 
            { auctionId }, 
            { 
                delay: durationSeconds * 1000,
                removeOnComplete: true, // Auto-clean memory state allocations upon completion
                removeOnFail: false    // Retain failed records for structural debugging logs
            }
        );

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
const wss = new WebSocketServer({ server });
const auctionRooms = new Map();

// 5. REDIS PUB/SUB SYSTEM INDEPENDENT NODE MULTIPLEXING
redisSubClient.psubscribe('auction:broadcast:*');
redisSubClient.on('pmessage', (pattern, channel, message) => {
    const auctionId = channel.split(':').pop();
    const localRoom = auctionRooms.get(auctionId);
    if (localRoom) {
        localRoom.forEach((client) => {
            // FIX: Checking standard binary connection state literal value (1 === OPEN)
            if (client.readyState === 1) client.send(message);
        });
    }
});

// 6. WEBSOCKET PIPELINE WITH INTEGRATED KAFKA EVERY-BID STREAMING
wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');
    const auctionId = urlParts[urlParts.length - 1];
    
    if (!auctionId) return ws.close(4000, 'Auction ID parameter missing');
    if (!auctionRooms.has(auctionId)) auctionRooms.set(auctionId, new Set());
    auctionRooms.get(auctionId).add(ws);

    ws.on('message', async (rawData) => {
        try {
           // Inside your ws.on('message', async (rawData) => { ... })
const timestamp = Date.now();
const memberPayload = JSON.stringify({ userId, ts: timestamp });

// We pass amount as ARGV[1], memberPayload as ARGV[2], and timestamp as ARGV[3]
const result = await redisClient.processStrictBid(zsetKey, hsetKey, amount, memberPayload, timestamp);

let bidStatus = 'REJECTED';

if (result === 1) {
    bidStatus = 'ACCEPTED';
    const broadcastPayload = JSON.stringify({ type: 'NEW_HIGHEST_BID', auctionId, userId, amount });
    await redisClient.publish(`auction:broadcast:${auctionId}`, broadcastPayload);
} else if (result === -1) {
    return ws.send(JSON.stringify({ type: 'ERROR', reason: 'Auction is not initialized.' }));
} else if (result === -2) {
    // Caches caught a late entry attempt after the deadline passed
    return ws.send(JSON.stringify({ type: 'AUCTION_EXPIRED', reason: 'This auction has concluded.' }));
} else {
    ws.send(JSON.stringify({ type: 'BID_REJECTED', reason: 'Bid too low.' }));
}

// Asynchronous durability path (Cold Path)
// Even if rejected, we stream it to Kafka for the audit trail to log the attempt
kafkaProducer.send({
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
            console.error('[Gateway Processing Error]', err);
            ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid operation.' }));
        }
    });

    ws.on('close', () => {
        if (auctionRooms.has(auctionId)) {
            auctionRooms.get(auctionId).delete(ws);
            if (auctionRooms.get(auctionId).size === 0) auctionRooms.delete(auctionId);
        }
    });
});

// -------------------------------------------------------------------------
// 7. DASHBOARD LOG & CACHE RECOVERY API ROUTES
// -------------------------------------------------------------------------

/**
 * Endpoint: Pull full comprehensive history logs for user dashboards.
 * Utilizes the custom compound index idx_bids_auction_amount to optimize scans.
 */
app.get('/api/auctions/:id/history', async (req, res) => {
    const auctionId = req.params.id;
    const { userId } = req.query; // Optional query filter: /history?userId=usr_123

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

/**
 * Endpoint: Disaster Recovery / Cache Warm-up
 * If a Redis instance undergoes a cold reboot or loses memory state, this route
 * queries the true System of Record (PostgreSQL) and seamlessly restores the hot path.
 */
app.post('/api/auctions/:id/recover', async (req, res) => {
    const auctionId = req.params.id;
    const dbClient = await pgPool.connect();

    try {
        // FIX: Explicitly select end_time from the System of Record
        const auctionRes = await dbClient.query(
            `SELECT title, start_price, status, end_time FROM auctions WHERE id = $1;`,
            [auctionId]
        );

        if (auctionRes.rows.length === 0) {
            return res.status(404).json({ error: "Auction not found within the System of Record." });
        }

        const { title, start_price: startPrice, status, end_time: endTime } = auctionRes.rows[0];

        // Fetch the absolute highest ACCEPTED bid processed by our database
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

        // Wipe out fragmented keys to ensure clean alignment
        await redisClient.del(hsetKey, zsetKey);

        // Calculate the unix millisecond string for the Lua time check boundary
        const expiresAtStr = endTime ? new Date(endTime).getTime().toString() : "0";

        if (highBidRes.rows.length > 0) {
            const highestBid = highBidRes.rows[0];
            const currentHighestAmount = highestBid.amount.toString();
            const memberPayload = JSON.stringify({ 
                userId: highestBid.user_id, 
                ts: new Date(highestBid.bid_timestamp).getTime() 
            });

            // Rebuild cache details metadata with the absolute time ceiling intact
            await redisClient.hset(hsetKey, {
                title: title,
                start_price: startPrice.toString(),
                current_highest_bid: currentHighestAmount,
                last_bidder: memberPayload,
                status: status,
                expires_at: expiresAtStr // <-- FIX: Restored to state engine
            });

            await redisClient.zadd(zsetKey, currentHighestAmount, memberPayload);
        } else {
            // No bids exist yet; default back to baseline initial seeding values
            await redisClient.hset(hsetKey, {
                title: title,
                start_price: startPrice.toString(),
                current_highest_bid: startPrice.toString(),
                status: status,
                expires_at: expiresAtStr // <-- FIX: Restored to state engine
            });
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

const lastLeaderboardCache = new Map(); // Tracks stringified states to avoid duplicate writes

async function leaderboardDeltaWorker() {
    try {
        if (auctionRooms.size === 0) {
            // No active connections across any auctions; sleep and try again
            return setTimeout(leaderboardDeltaWorker, 250);
        }

        // Loop through only the auctions that currently have active web socket listeners
        for (const auctionId of auctionRooms.keys()) {
            const zsetKey = `auction:leaderboard:${auctionId}`;
            
            // Fetch the top 5 bids along with their payloads dynamically
            // ZREVRANGE returns alternating array elements: [member1, score1, member2, score2...]
            const topBidsRaw = await redisClient.zrevrange(zsetKey, 0, 4, 'WITHSCORES');
            
            if (!topBidsRaw || topBidsRaw.length === 0) continue;

            // Format raw Redis strings into a structured data payload
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

            // State Check: Only send if the ranking hierarchy or amounts changed since the last 250ms tick
            if (lastLeaderboardCache.get(auctionId) !== payloadString) {
                lastLeaderboardCache.set(auctionId, payloadString);
                
                // Publish down the Redis Pub/Sub multiplexer network channel
                await redisClient.publish(`auction:broadcast:${auctionId}`, payloadString);
            }
        }
    } catch (err) {
        console.error('[Leaderboard Delta Worker Error]', err);
    } finally {
        setTimeout(leaderboardDeltaWorker, 250); // Tick precisely every 250ms
    }
}

// Start the Delta Streamer Daemon
leaderboardDeltaWorker();


async function shutdown() {
    console.log("Shutting down...");

    await kafkaProducer.disconnect();
    await redisClient.quit();
    await redisSubClient.quit();
    await pgPool.end();

    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
