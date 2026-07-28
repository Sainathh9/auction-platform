import 'dotenv/config';
import WebSocket from 'ws';
import fetch from 'node-fetch';

const AUCTION_ID = `stress_auc_${Date.now()}`;
const TARGET_URL = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3000';
const CONCURRENT_CLIENTS = 50;

async function runStressTest() {
    console.log('--- STARTING HIGH-CONCURRENCY STRESS TEST ---');

    // 1. Seed a clean auction
    console.log(`[1/4] Seeding auction ${AUCTION_ID}...`);
    const seedRes = await fetch(`${TARGET_URL}/api/auctions/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            auctionId: AUCTION_ID,
            title: 'High Concurrency Stress Target Asset',
            startPrice: 1000
        })
    });
    const seedData = await seedRes.json();
    console.log(`     Status: ${seedRes.status} - ${seedData.message || seedData.error}`);

    // 2. Spin up concurrent WebSocket connections
    console.log(`[2/4] Initializing ${CONCURRENT_CLIENTS} concurrent connections...`);
    const clients = [];
    const connectionPromises = Array.from({ length: CONCURRENT_CLIENTS }).map((_, i) => {
        return new Promise((resolve) => {
            const ws = new WebSocket(`${WS_URL}/${AUCTION_ID}`);
            ws.on('open', () => {
                clients.push(ws);
                resolve();
            });
            
            // Track message feedback metrics
            ws.acceptedCount = 0;
            ws.rejectedCount = 0;
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'NEW_HIGHEST_BID') ws.acceptedCount++;
                if (msg.type === 'BID_REJECTED') ws.rejectedCount++;
            });
        });
    });

    await Promise.all(connectionPromises);
    console.log(`     All ${CONCURRENT_CLIENTS} clients connected securely.`);

    // 3. Flood the engine at the exact same instant
    console.log('[3/4] Blasting simultaneous concurrent traffic lines...');
    
    // Each user bids an incrementing amount: $1005, $1010, $1015... up to $1250
    // Because they fire simultaneously, only the highest values should clear
   // Inside stress-test.js -> Step 3 loop
const sendPromises = clients.map((ws, index) => {
    // FIX: All 50 users bid exactly $1500 at the same time.
    // Only the very first one processed by Redis should be ACCEPTED. The other 49 must be REJECTED.
    const bidAmount = 1500; 
    const payload = JSON.stringify({
        userId: `stress_user_${index}`,
        amount: bidAmount
    });
    return new Promise((resolve) => {
        ws.send(payload);
        setTimeout(resolve, 1500);
    });
});

    await Promise.all(sendPromises);
    
    // Close client hooks
    clients.forEach(ws => ws.close());

    // 4. Verify Database Integrity (The Ultimate Test)
    console.log('[4/4] Extracting cold path logs to verify synchronization accuracy...');
    const historyRes = await fetch(`${TARGET_URL}/api/auctions/${AUCTION_ID}/history`);
    const historyData = await historyRes.json();

    console.log('\n--- CONCURRENCY RESULTS ---');
    console.log(`Total Bids Fired:                 ${CONCURRENT_CLIENTS}`);
    console.log(`Total Bids Captured in Database:  ${historyData.totalBidsRecorded}`);
    
    const acceptedInDb = historyData.history.filter(b => b.status === 'ACCEPTED').length;
    const rejectedInDb = historyData.history.filter(b => b.status === 'REJECTED').length;
    
    console.log(`Successfully Accepted in DB:     ${acceptedInDb}`);
    console.log(`Correctly Rejected in DB:        ${rejectedInDb}`);

    if (historyData.totalBidsRecorded === CONCURRENT_CLIENTS) {
        console.log('\n✓ PERFECT CONCURRENCY MATCH: Zero dropped packets. Kafka handled full pipeline volume smoothly.');
    } else {
        console.log('\n✗ MISMATCH DETECTED: Data drift occurred between the hot path memory engine and the database worker.');
    }
}

runStressTest().catch(console.error);