/**
 * usePortalSocket — caregiver Socket.IO connection (JWT handshake, auth.token).
 * The server joins the socket to the caregiver's patient rooms on connect, so
 * device:status / interaction:new arrive without an explicit join.
 */
import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { getSession } from './session'

const API = import.meta.env.VITE_API_URL || ''

export function usePortalSocket() {
  // Created once (not connected yet); the effect owns connect / disconnect
  const [socket] = useState(() => {
    const token = getSession()?.token
    return token
      ? io(API, { auth: { token }, transports: ['websocket'], reconnection: true, reconnectionDelay: 1000, autoConnect: false })
      : null
  })
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!socket) return
    const onConnect    = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onError      = (err) => console.error('portal socket:', err.message)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onError)
    socket.connect()
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onError)
      socket.disconnect()
    }
  }, [socket])

  return { socket, connected }
}

/** emit with an ack, rejecting after `timeoutMs` (socket.io acks never fire when offline). */
export function emitWithAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('offline'))
      return
    }
    socket.timeout(timeoutMs).emit(event, payload, (err, ack) => {
      if (err) reject(new Error('timeout'))
      else if (!ack?.success) reject(new Error(ack?.error || 'failed'))
      else resolve(ack)
    })
  })
}
