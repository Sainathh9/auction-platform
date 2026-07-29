import WebSocket from 'ws';

const auctionId = 'AUC-386xri'; // or just any ID
const ws = new WebSocket(`ws://localhost:3000/ws/${auctionId}?token=`);

ws.on('open', () => {
    console.log('[GUEST] Connected successfully!');
    
    // Try to bid
    ws.send(JSON.stringify({ userId: 'USR-a1b2', amount: 500000 }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[GUEST] Received:', msg.type, msg);
    if (msg.type === 'ERROR') {
        setTimeout(() => process.exit(0), 500);
    }
});
