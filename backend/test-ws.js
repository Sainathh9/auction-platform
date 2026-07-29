import Redis from 'ioredis';
import WebSocket from 'ws';

const auctionId = 'AUC-386xri'; // or just any ID


// We can't connect without a valid JWT token. 
// Let's just create a valid JWT token first.
import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'your-production-secret-key';
const token = jwt.sign({ sub: 'test-user', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });

const ws2 = new WebSocket(`ws://localhost:3000/ws/${auctionId}?token=${token}`);
const ws3 = new WebSocket(`ws://localhost:3000/ws/${auctionId}?token=${token}`);

ws3.on('open', () => {
    console.log('[WS3] Connected, listening for broadcasts...');
});

ws3.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[WS3] Received:', msg.type, msg);
});

ws2.on('open', () => {
    console.log('[WS2] Connected with valid token');
    
    // Simulate placing a bid
    ws2.send(JSON.stringify({ userId: 'test-user', amount: 200000 }));
});

ws2.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[WS2] Received:', msg.type, msg);
    if (msg.type === 'BID_ACK') {
        setTimeout(() => process.exit(0), 1000);
    }
});
