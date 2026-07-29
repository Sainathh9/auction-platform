import { useState, useEffect, useRef, useCallback } from 'react';
import { WS_BASE } from '../lib/constants';

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

/**
 * Custom hook to manage a WebSocket connection for real-time auction bidding.
 * Incorporates automatic exponential backoff for reconnections.
 *
 * @param {string} auctionId - The unique identifier of the auction room.
 * @param {Function} [onMessage] - Stable callback to process incoming messages without triggering React state batching issues.
 * @returns {Object} Object containing connection status, last message payload, and a sendBid function.
 */
export function useWebSocket(auctionId, onMessage) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!auctionId) return;

    try {
      const activeToken = localStorage.getItem('artmart_jwt_token') || '';
      const url = `${WS_BASE}/${encodeURIComponent(auctionId)}?token=${encodeURIComponent(activeToken)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        reconnectAttempt.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (onMessage) onMessage(data);
          setLastMessage(data);
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        wsRef.current = null;

        // Initiate automatic reconnection using exponential backoff strategy
        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)];
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setIsConnected(false);
    }
  }, [auctionId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  /**
   * Transmits a bid payload over the active WebSocket connection.
   * @param {string} userId - The identifier of the bidding user.
   * @param {number} amount - The bid amount.
   * @returns {boolean} True if the message was successfully queued for sending.
   */
  const sendBid = useCallback((userId, amount) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ userId, amount }));
      return true;
    }
    return false;
  }, []);

  return { isConnected, lastMessage, sendBid };
}
