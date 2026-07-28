import { WebSocket } from 'ws';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-production-secret-key';

const TARGET_AUCTION = 'perf_stress_test_999';
const HTTP_URL = 'http://localhost:3000';

const CONCURRENT_USERS = 50;  // Simulated unique bidders
const BIDS_PER_USER = 20;     // Messages sent sequentially per user loop
const BASE_START_PRICE = 100;

async function executeStressTest() {
    console.log('🚀 Step 1: Seeding live auction via HTTP gateway...');
    try {
        await axios.post(`${HTTP_URL}/api/auctions/seed`, {
            auctionId: TARGET_AUCTION,
            title: 'High Stress Scale Testing',
            startPrice: BASE_START_PRICE,
            durationSeconds: 15
        });
        console.log('✅ Auction seeded successfully. BullMQ timer active.');
    } catch (err) {
        console.error('❌ Failed to seed auction for load test:', err.response ? err.response.data : err.stack);
        process.exit(1);
    }

    console.log(`\n⚡ Step 2: Spawning ${CONCURRENT_USERS} WebSocket bidder connections...`);
    
    const workerPromises = Array.from({ length: CONCURRENT_USERS }).map((_, userIdx) => {
        return new Promise((resolve) => {
            const userId = `user_bot_${userIdx}`;
            const token = jwt.sign({ userId }, JWT_SECRET);
            const userWsUrl = `ws://localhost:3000/ws/${TARGET_AUCTION}?token=${token}`;
            const ws = new WebSocket(userWsUrl);

            let acceptedCount = 0;
            let rejectedCount = 0;
            let bidsSent = 0;

            ws.on('open', () => {
                // Throttle connection burst slightly to simulate real distributed network arrivals
                setTimeout(async () => {
                    for (let i = 0; i < BIDS_PER_USER; i++) {
                        bidsSent++;
                        // Incremental bids to trigger competitive collisions
                        const bidAmount = BASE_START_PRICE + (userIdx * 5) + i; 
                        
                        ws.send(JSON.stringify({
                            userId,
                            amount: bidAmount
                        }));
                        
                        // Small 10ms network pause between actions per single user
                        await new Promise(r => setTimeout(r, 10)); 
                    }
                }, Math.random() * 200); 
            });

            ws.on('message', (data) => {
                const response = JSON.parse(data);
                if (response.type === 'BID_ACK' && response.status === 'ACCEPTED') {
                    acceptedCount++;
                } else if (response.type === 'BID_REJECTED') {
                    rejectedCount++;
                } else if (response.type === 'AUCTION_CONCLUDED') {
                    ws.close();
                }
            });

            ws.on('close', () => {
                resolve({ userId, bidsSent, acceptedCount, rejectedCount });
            });

            // Auto-fallback timeout closure if connection hangs past auction boundary
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) ws.close();
            }, 16000);
        });
    });

    console.log('🔥 Simulation running. Colliding state machines inside Redis...');
    const results = await Promise.all(workerPromises);
    
    console.log('\n📊 --- SIMULATION METRICS RUN DOWN ---');
    const totalSent = results.reduce((acc, curr) => acc + curr.bidsSent, 0);
    const totalAccepted = results.reduce((acc, curr) => acc + curr.acceptedCount, 0);
    const totalRejected = results.reduce((acc, curr) => acc + curr.rejectedCount, 0);

    console.log(`Total Bid Packets Transmitted: ${totalSent}`);
    console.log(`Total Globally Accepted Bids:  ${totalAccepted}`);
    console.log(`Total Atomically Rejected Bids: ${totalRejected}`);
    console.log('---------------------------------------');
    
    console.log('\n📡 Step 3: Verifying final production metrics from server...');
    try {
        const metricsRes = await axios.get(`${HTTP_URL}/metrics`);
        const lines = metricsRes.data.split('\n');
        
        const throughputLines = lines.filter(l => l.startsWith('bidding_engine_bids_total'));
        console.log('\nLive Prometheus Totals:');
        throughputLines.forEach(line => console.log(`  ${line}`));
    } catch (err) {
        console.error('Could not pull live Prometheus stats:', err.message);
    }
}

executeStressTest();