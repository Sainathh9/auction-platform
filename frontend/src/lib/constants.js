export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
export const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:3000';

// Mock JWT for dev — the backend accepts any valid JWT signed with the default secret
export const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkZXYtdXNlci0xIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9.placeholder';

export const CATEGORIES = ['Electronics', 'Art', 'Collectibles', 'Vehicles', 'Real Estate', 'Jewelry'];

export const AUCTION_STATUS = {
  ACTIVE: 'ACTIVE',
  FINISHED: 'FINISHED',
};

export const BID_STATUS = {
  WINNING: 'WINNING',
  OUTBID: 'OUTBID',
  LOST: 'LOST',
};
