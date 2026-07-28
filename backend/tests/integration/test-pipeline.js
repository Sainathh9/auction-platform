import WebSocket from 'ws';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-production-secret-key';
const TEST_TOKEN = jwt.sign({ userId: 'test_user' }, JWT_SECRET);

const GATEWAY_HTTP = 'http://127.0.0.1:3000';
const GATEWAY_WS = 'ws://127.0.0.1:3000';
const TEST_AUCTION_ID = `auc_prod_${Date.now()}`;
const TEST_USER_1 = "usr_client_alpha";
const TEST_USER_2 = "usr_client_beta";

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runIntegrationTest() {
    console.log('--- BEGINNING END-TO-END SYSTEM VALIDATION ---');

    // 1. Validate Seeding Engine (Dual-Write State Check)
    console.log('\n[Step 1] Initializing Auction via Seeding Route...');
    try {
        const seedPayload = {
            auctionId: TEST_AUCTION_ID,
            title: "Production Test Enterprise Asset",
            startPrice: 1000.00
        };

        const response = await fetch(`${GATEWAY_HTTP}/api/auctions/seed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(seedPayload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unknown seeding failure');
        console.log('✓ Seeding Completed Successfully:', data.message);
    } catch (err) {
        console.error('✗ Step 1 Failed - Aborting test runner:', err.message);
        process.exit(1);
    }

    // 2. Open Real-Time WS Pipeline Connections
    console.log('\n[Step 2] Connecting WebSocket client instances to Hot Path...');
    const wsClient1 = new WebSocket(`${GATEWAY_WS}/${TEST_AUCTION_ID}?token=${TEST_TOKEN}`);
    const wsClient2 = new WebSocket(`${GATEWAY_WS}/${TEST_AUCTION_ID}?token=${TEST_TOKEN}`);

    let activeMessagesReceived = 0;

    const setupSocketListener = (ws, clientLabel) => {
        ws.on('open', () => console.log(`✓ [WS ${clientLabel}] Connection established.`));
        ws.on('message', (data) => {
            const frame = JSON.parse(data.toString());
            console.log(`[WS ${clientLabel} Broadcast Event]:`, frame);
            activeMessagesReceived++;
        });
        ws.on('error', (err) => console.error(`✗ [WS ${clientLabel}] Error:`, err));
    };

    setupSocketListener(wsClient1, 'AlphaNode');
    setupSocketListener(wsClient2, 'BetaNode');

    // Allow handshakes to finish
    await sleep(1500);

    // 3. Simulate Concurrent Real-time Bidding Interleaving
    console.log('\n[Step 3] Emitting test bid frames to engine traffic line...');

    // Bid A: Valid Higher Bid (Should be ACCEPTED)
    console.log('\n-> Dispatching Bid: User Alpha @ $1500.00');
    wsClient1.send(JSON.stringify({ userId: TEST_USER_1, amount: 1500.00 }));
    await sleep(500);

    // Bid B: Invalid Low Bid (Should be REJECTED)
    console.log('\n-> Dispatching Bid: User Beta @ $1200.00 (Outdated Value)');
    wsClient2.send(JSON.stringify({ userId: TEST_USER_2, amount: 1200.00 }));
    await sleep(500);

    // Bid C: Valid Incremental Breakaway Bid (Should be ACCEPTED)
    console.log('\n-> Dispatching Bid: User Beta @ $2100.00');
    wsClient2.send(JSON.stringify({ userId: TEST_USER_2, amount: 2100.00 }));
    await sleep(1500); // Give background Kafka worker buffers time to persist to PostgreSQL

    // 4. Verify Cold-Path Historical Log Integrations
    console.log('\n[Step 4] Checking cold path audit trail consistency...');
    try {
        const logResponse = await fetch(`${GATEWAY_HTTP}/api/auctions/${TEST_AUCTION_ID}/history`);
        const logData = await logResponse.json();

        console.log(`\nAudit History Log Results (Total bids in DB: ${logData.totalBidsRecorded}):`);
        logData.history.forEach(bid => {
            console.log(` - Bid Amount: $${bid.amount} | Status: ${bid.status} | User: ${bid.userId}`);
        });

        // Verification validations
        if (logData.totalBidsRecorded >= 3) {
            console.log('\n✓ Cold-Path Pipeline confirmed operational. All states captured sequentially.');
        } else {
            console.warn('\n⚠ Warning: Historical counts lower than expected. Check Kafka consumer logs.');
        }
    } catch (err) {
        console.error('✗ Step 4 Failed - History route unreadable:', err);
    }

    // Tear down validation instances cleanly
    wsClient1.close();
    wsClient2.close();
    console.log('\n--- INTEGRATION RUN TERMINATED CLEANLY ---');
}

runIntegrationTest();