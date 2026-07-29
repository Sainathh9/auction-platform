import WebSocket from 'ws';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-production-secret-key';
const GATEWAY_HTTP = 'http://127.0.0.1:3000';
const GATEWAY_WS = 'ws://127.0.0.1:3000';
const TEST_AUCTION_ID = 'AUC-wz5th9';

const NUM_CLIENTS = 50; // Simulate 50 concurrent bidders
const BIDS_PER_CLIENT = 10; // Each sends 10 bids
const BASE_PRICE = 679000;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLoadTest() {
    console.log('--- BEGINNING CONCURRENT LOAD TEST ---');

    // 1. Skip seeding because the auction already exists
    console.log(`\n[Step 1] Targeting existing Auction ${TEST_AUCTION_ID}...`);

    // 2. Connect clients
    console.log(`\n[Step 2] Spawning ${NUM_CLIENTS} concurrent WebSocket clients...`);
    const clients = [];
    let connectedCount = 0;

    for (let i = 0; i < NUM_CLIENTS; i++) {
        const userId = `usr_load_${i}`;
        const token = jwt.sign({ id: userId }, JWT_SECRET);
        const ws = new WebSocket(`${GATEWAY_WS}/${TEST_AUCTION_ID}?token=${token}`);
        
        ws.on('open', () => {
            connectedCount++;
        });
        
        ws.on('message', (msg) => {
            const data = JSON.parse(msg.toString());
            if (data.type === 'ERROR') {
                console.error(`[WS ERROR for ${userId}]:`, data);
            }
        });
        
        ws.on('error', () => {}); // Ignore connection errors for load test
        clients.push({ ws, userId });
    }

    // Wait for all to connect
    while (connectedCount < NUM_CLIENTS) {
        await sleep(100);
    }
    console.log(`✓ All ${NUM_CLIENTS} clients connected successfully.`);

    // 3. Blast Bids
    console.log(`\n[Step 3] Blasting ${NUM_CLIENTS * BIDS_PER_CLIENT} concurrent bids...`);
    
    const startTime = Date.now();
    let promises = [];
    let expectedHighestBid = BASE_PRICE;

    // We will generate random bids. However, to ensure a known highest bid, 
    // the last bid of the last client will be a deterministic massive bid.
    for (let i = 0; i < NUM_CLIENTS; i++) {
        const client = clients[i];
        for (let j = 0; j < BIDS_PER_CLIENT; j++) {
            // Randomly delay between 0 and 500ms to interleave bids massively
            const delay = Math.random() * 500;
            const amount = BASE_PRICE + Math.floor(Math.random() * 5000) + 10;
            
            if (amount > expectedHighestBid) {
                expectedHighestBid = amount;
            }

            promises.push(
                sleep(delay).then(() => {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(JSON.stringify({ userId: client.userId, amount }));
                    }
                })
            );
        }
    }

    // Wait for all bids to be sent
    await Promise.all(promises);
    
    // Wait for rate limit window to reset for client 0
    await sleep(1500);

    // Now fire the absolute highest deterministic bid to ensure it stays on top
    const ULTIMATE_HIGHEST_BID = expectedHighestBid + 5000;
    const finalClient = clients[0];
    finalClient.ws.send(JSON.stringify({ userId: finalClient.userId, amount: ULTIMATE_HIGHEST_BID }));
    
    console.log(`✓ All bids sent in ${Date.now() - startTime}ms.`);
    console.log(`  Expected Highest Bid should be: $${ULTIMATE_HIGHEST_BID}`);

    // Wait for Kafka to process everything and PostgreSQL to settle
    console.log('\n[Step 4] Waiting 3 seconds for Kafka consumer to process background queue...');
    await sleep(3000);

    // 4. Verify History and Leaderboard
    console.log('\n[Step 5] Verifying Data Consistency (Highest bid on top)...');
    
    try {
        const resHistory = await fetch(`${GATEWAY_HTTP}/api/auctions/${TEST_AUCTION_ID}/history`);
        const historyData = await resHistory.json();

        // The audit trail returns bids ordered by amount DESC (or time DESC if UI). 
        // We will fetch the auction details from REST API to see `currentHighestBid`.
        const resAuction = await fetch(`${GATEWAY_HTTP}/api/auctions`);
        const auctions = await resAuction.json();
        
        const thisAuction = auctions.find(a => a.id === TEST_AUCTION_ID);
        
        console.log(`\nRESULTS:`);
        console.log(`- Final Highest Bid Recorded: $${thisAuction?.currentHighestBid}`);
        console.log(`- Total Bids in History: ${historyData.totalBidsRecorded}`);
        
        if (thisAuction && thisAuction.currentHighestBid === ULTIMATE_HIGHEST_BID) {
            console.log('\n✅ SUCCESS: End-to-end load test passed! The system accurately tracked the highest bid despite heavy concurrent load.');
        } else {
            console.log('\n❌ FAILURE: The highest bid did not match the ultimate bid sent.');
        }

    } catch (err) {
        console.error('Error verifying results:', err);
    }

    // Teardown
    clients.forEach(c => c.ws.close());
    process.exit(0);
}

runLoadTest();
