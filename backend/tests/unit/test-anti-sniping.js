import { WebSocket } from 'ws';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-production-secret-key';
const TEST_TOKEN = jwt.sign({ userId: 'test_user' }, JWT_SECRET);

const TARGET_AUCTION = 'sniping_test_101';
const HTTP_URL = 'http://localhost:3000';
const WS_URL = `ws://localhost:3000/ws/${TARGET_AUCTION}?token=${TEST_TOKEN}`;

async function testAntiSniping() {
    console.log('🚀 1. Seeding 15-second auction...');
    const startTime = Date.now();
    await axios.post(`${HTTP_URL}/api/auctions/seed`, {
        auctionId: TARGET_AUCTION,
        title: 'Anti-Sniping Test Auction',
        startPrice: 100,
        durationSeconds: 15
    });

    console.log('🔌 2. Opening WebSocket subscriber...');
    const ws = new WebSocket(WS_URL);

    ws.on('open', async () => {
        console.log('⏳ 3. Waiting 7 seconds to enter anti-sniping window...');
        await new Promise((r) => setTimeout(r, 7000));

        console.log(`⚡ 4. Transmitting sniper bid ($150) at +${(Date.now() - startTime)/1000}s...`);
        ws.send(JSON.stringify({ userId: 'sniper_bot_1', amount: 150 }));
    });

    ws.on('message', (data) => {
        const payload = JSON.parse(data.toString());
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`📡 [+${elapsed}s] Received event:`, payload.type, payload);

        if (payload.type === 'AUCTION_CONCLUDED') {
            console.log(`🏁 Auction concluded cleanly at total elapsed time: ${elapsed}s`);
            ws.close();
            process.exit(0);
        }
    });
}

testAntiSniping();