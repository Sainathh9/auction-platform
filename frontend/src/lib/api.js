import { API_BASE } from './constants';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    console.warn(`[API] ${options.method || 'GET'} ${path} failed:`, err.message);
    throw err;
  }
}

export function seedAuction({ auctionId, title, startPrice, durationSeconds }) {
  return request('/api/auctions/seed', {
    method: 'POST',
    body: JSON.stringify({ auctionId, title, startPrice, durationSeconds }),
  });
}

export function getAuctionHistory(auctionId, userId) {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return request(`/api/auctions/${encodeURIComponent(auctionId)}/history${params}`);
}

export function recoverAuction(auctionId) {
  return request(`/api/auctions/${encodeURIComponent(auctionId)}/recover`, {
    method: 'POST',
  });
}
