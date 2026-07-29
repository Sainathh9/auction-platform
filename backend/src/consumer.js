import 'dotenv/config';
import { Kafka, Partitioners } from 'kafkajs';
import pkg from 'pg';
const { Pool } = pkg;

const PG_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || '10', 10);
const KAFKA_BROKERS = process.env.KAFKA_BROKERS 
    ? process.env.KAFKA_BROKERS.split(',') 
    : ['localhost:9092'];

// PostgreSQL Connection Pool
const pgPool = new Pool({
    user: process.env.DB_USER || 'sainath',
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'bidding_engine',
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: PG_POOL_SIZE
});

// Kafka Consumer Setup
const kafka = new Kafka({
    clientId: 'auction-db-writer',
    brokers: KAFKA_BROKERS
});

const consumer = kafka.consumer({ 
    groupId: 'auction-db-write-group',
    allowAutoTopicCreation: true
});

async function runConsumer() {
    await consumer.connect();
    console.log('[Kafka Consumer] Connected to broker group: auction-db-write-group');

    await consumer.subscribe({ topic: 'auction-bids', fromBeginning: false });

    await consumer.run({
        // Tune batching for high throughput
        eachBatchAutoResolve: true,
        eachBatch: async ({ batch, resolveOffset, heartbeat, isAlive }) => {
            const messages = batch.messages;
            if (!messages.length) return;

            const validBids = [];

            for (const message of messages) {
                try {
                    const bid = JSON.parse(message.value.toString());
                    // Only store accepted or structurally processed bids in PostgreSQL history
                    if (bid.auctionId && bid.userId && bid.amount) {
                        validBids.push({
                            auctionId: bid.auctionId,
                            userId: bid.userId,
                            amount: bid.amount,
                            status: bid.status || 'ACCEPTED',
                            timestamp: new Date(bid.timestamp || Date.now())
                        });
                    }
                } catch (err) {
                    console.error('[Consumer Payload Error] Skipping corrupt message:', err.message);
                }
            }

            if (validBids.length === 0) return;

            // Micro-batch multi-row INSERT into PostgreSQL
            const client = await pgPool.connect();
            try {
                await client.query('BEGIN');

                // Build dynamic parameterized query for batch insert
                const valueTuples = [];
                const queryParams = [];
                let paramIdx = 1;

                for (const bid of validBids) {
                    valueTuples.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`);
                    queryParams.push(bid.auctionId, bid.userId, bid.amount, bid.status, bid.timestamp);
                    paramIdx += 5;
                }

                const batchInsertQuery = `
                    INSERT INTO bids (auction_id, user_id, amount, status, bid_timestamp)
                    VALUES ${valueTuples.join(', ')}
                    ON CONFLICT DO NOTHING;
                `;

                await client.query(batchInsertQuery, queryParams);

                // Also keep current_highest_bid in sync on the auctions table for accepted bids
                const acceptedBids = validBids.filter(b => b.status === 'ACCEPTED');
                if (acceptedBids.length > 0) {
                    // Group by auctionId to find max amount in this batch
                    const maxByAuction = {};
                    const bidCounts = {};
                    for (const b of acceptedBids) {
                        if (!maxByAuction[b.auctionId] || b.amount > maxByAuction[b.auctionId]) {
                            maxByAuction[b.auctionId] = b.amount;
                        }
                        bidCounts[b.auctionId] = (bidCounts[b.auctionId] || 0) + 1;
                    }

                    for (const [auctionId, maxAmount] of Object.entries(maxByAuction)) {
                        await client.query(
                            `UPDATE auctions 
                             SET current_highest_bid = GREATEST(current_highest_bid, $1),
                                 bid_count = bid_count + $2
                             WHERE id = $3;`,
                            [maxAmount, bidCounts[auctionId], auctionId]
                        );
                    }
                }

                await client.query('COMMIT');
                console.log(`[Kafka Consumer] Batch written: ${validBids.length} bids saved to Postgres.`);

                // Resolve offsets to mark as processed
                for (const message of messages) {
                    resolveOffset(message.offset);
                }
                await heartbeat();

            } catch (dbErr) {
                await client.query('ROLLBACK');
                console.error('[Consumer DB Write Error] Batch rollback executed:', dbErr);
                throw dbErr; // Triggers KafkaJS re-seek/retry
            } finally {
                client.release();
            }
        }
    });
}

runConsumer().catch(err => {
    console.error('[Kafka Consumer Fatal Error]', err);
    process.exit(1);
});

async function shutdown() {
    console.log('[Consumer] Graceful shutdown initiated...');
    await consumer.disconnect();
    await pgPool.end();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);