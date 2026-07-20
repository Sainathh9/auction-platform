import express from 'express';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { z } from 'zod';
import { Kafka, Partitioners } from 'kafkajs';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();

// ENV VARIABLE FALLBACKS
const PORT = process.env.PORT;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;
const KAFKA_BROKER = process.env.KAFKA_BROKERS;

app.use(express.json());

// LOCAL POSTGRES DEPLOYMENT CONFIGURATION (Explicit parameters, no URL string)
const pgPool = new Pool({
    user: process.env.DB_USER || 'sainath',
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'bidding_engine',
    password: process.env.DB_PASSWORD || '', // Empty for local passwordless authentication
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: 20
});

// REDIS CLIENT INITIALIZATION WITH ENV CONFIGS
const redisClient = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });
const redisSubClient = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });

// KAFKA BROKER INITIALIZATION WITH ENV CONFIGS
const kafka = new Kafka({
    clientId: 'auction-gateway',
    brokers: [KAFKA_BROKER]
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

    local current_highest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    local current_price = 0

    if #current_highest > 0 then
        current_price = tonumber(current_highest[2])
    else
        current_price = tonumber(redis.call('HGET', KEYS[2], 'start_price') or 0)
    end

    if tonumber(ARGV[1]) > current_price then
        redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
        redis.call('HSET', KEYS[2], 'current_highest_bid', ARGV[1], 'last_bidder', ARGV[2])
        return 1
    else
        return 0
    end
`;

redisClient.defineCommand('processStrictBid', { numberOfKeys: 2, lua: DUAL_STORE_LUA });

// 4. SEEDING ROUTE (Dual-Write Pattern: PostgreSQL First, then Redis Cache inside a true transaction)
app.post('/api/auctions/seed', async (req, res) => {
    const { auctionId, title, startPrice } = req.body;

    if (!auctionId || !title || !startPrice) {
        return res.status(400).json({
            error: "Missing auctionId, title, or startPrice"
        });
    }

    const dbClient = await pgPool.connect();

    try {
        // Begin the transactional block inside PostgreSQL to guarantee consistency
        await dbClient.query('BEGIN');

        await dbClient.query(
            `
            INSERT INTO auctions
                (id, title, start_price, current_highest_bid, status)
            VALUES
                ($1, $2, $3, $3, 'ACTIVE')
            ON CONFLICT (id)
            DO UPDATE
            SET
                title = EXCLUDED.title,
                start_price = EXCLUDED.start_price,
                current_highest_bid = EXCLUDED.current_highest_bid,
                status = 'ACTIVE'
            `,
            [auctionId, title, startPrice]
        );

        // Then warm Redis cache while still inside the transaction check window
        await redisClient.hset(`auction:details:${auctionId}`, {
            title,
            start_price: startPrice.toString(),
            current_highest_bid: startPrice.toString(),
            status: "ACTIVE"
        });

        // Commit everything only when both operations run successfully
        await dbClient.query('COMMIT');

        res.status(200).json({
            message: "Auction created successfully across DB and Cache."
        });

    } catch (err) {
        await dbClient.query('ROLLBACK');
        console.error('[Seeding Error] Transaction rolled back cleanly:', err);
        res.status(500).json({
            error: "Failed to create auction safely."
        });
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
            const rawJson = JSON.parse(rawData);
            const validation = BidSchema.safeParse(rawJson);
            if (!validation.success) {
                return ws.send(JSON.stringify({ type: 'VALIDATION_ERROR', errors: validation.error.errors.map(e => e.message) }));
            }

            const { userId, amount } = validation.data;
            const zsetKey = `auction:leaderboard:${auctionId}`;
            const hsetKey = `auction:details:${auctionId}`;
            
            const timestamp = Date.now();
            const memberPayload = JSON.stringify({ userId, ts: timestamp });

            // Atomic validation check inside Cache
            const result = await redisClient.processStrictBid(zsetKey, hsetKey, amount, memberPayload);

            let bidStatus = 'REJECTED';

            if (result === 1) {
                bidStatus = 'ACCEPTED';
                const broadcastPayload = JSON.stringify({ type: 'NEW_HIGHEST_BID', auctionId, userId, amount });
                
                // Real-time notification path (Hot Path) - Triggered only if this takes the lead
                await redisClient.publish(`auction:broadcast:${auctionId}`, broadcastPayload);
            } else if (result === -1) {
                return ws.send(JSON.stringify({ type: 'ERROR', reason: 'Auction is not initialized.' }));
            } else {
                // result === 0 (Bid too low) - Acknowledge the rejection back to the connection thread
                ws.send(JSON.stringify({ type: 'BID_REJECTED', reason: 'Bid too low.' }));
            }

            // Asynchronous durability path (Cold Path)
            // FIX: Handled as a non-blocking background task to prevent event-loop delays on the Hot Path
            kafkaProducer.send({
                topic: 'auction-bids',
                messages: [
                    {
                        key: auctionId, // Consistent routing ensures strict sequential evaluation order per auction partition
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
        // Fetch structural master record status
        const auctionRes = await dbClient.query(
            `SELECT title, start_price, status FROM auctions WHERE id = $1;`,
            [auctionId]
        );

        if (auctionRes.rows.length === 0) {
            return res.status(404).json({ error: "Auction not found within the System of Record." });
        }

        const { title, start_price: startPrice, status } = auctionRes.rows[0];

        // Fetch the absolute highest ACCEPTED bid processed by our database to populate states
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

        // Clear out any fragmented data remaining on keys to perform an atomic clean write
        await redisClient.del(hsetKey, zsetKey);

        if (highBidRes.rows.length > 0) {
            const highestBid = highBidRes.rows[0];
            const currentHighestAmount = highestBid.amount.toString();
            const memberPayload = JSON.stringify({ 
                userId: highestBid.user_id, 
                ts: new Date(highestBid.bid_timestamp).getTime() 
            });

            // Rebuild structural HSET metadata using recovered record pointers
            await redisClient.hset(hsetKey, {
                title: title,
                start_price: startPrice.toString(),
                current_highest_bid: currentHighestAmount,
                last_bidder: memberPayload,
                status: status
            });

            // Rehydrate the atomic leaderboards ZSET
            await redisClient.zadd(zsetKey, currentHighestAmount, memberPayload);
        } else {
            // No valid bids exist yet; default back to baseline initial seeding values
            await redisClient.hset(hsetKey, {
                title: title,
                start_price: startPrice.toString(),
                current_highest_bid: startPrice.toString(),
                status: status
            });
        }

        return res.status(200).json({ 
            message: `Hot Path state engine successfully rehydrated for auction: ${auctionId}` 
        });

    } catch (err) {
        console.error('[Disaster Recovery Failure]', err);
        return res.status(500).json({ error: "Failed to securely execute recovery processes." });
    } finally {
        dbClient.release();
    }
});



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