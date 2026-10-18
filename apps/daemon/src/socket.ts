import WebSocket from "ws"

/** Bound connection establishment separately from the heartbeat of an already-open socket. */
export function connectSocket(url: string, token: string, handshakeTimeoutMs = 30_000): WebSocket {
  return new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: handshakeTimeoutMs,
  })
}
