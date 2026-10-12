import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const API = import.meta.env.VITE_API_URL || ''

export function useSocket(deviceToken) {
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!deviceToken) return

    const socket = io(API, {
      auth: { device_token: deviceToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    })

    socket.on('connect', () => {
      setConnected(true)
      // Re-join patient room if we already have a patient_id
      const pid = localStorage.getItem('patient_id')
      if (pid) socket.emit('join:patient', { patient_id: pid })
    })
    socket.on('disconnect', () => setConnected(false))

    socketRef.current = socket
    return () => socket.disconnect()
  }, [deviceToken])

  const emit = (event, data) => {
    socketRef.current?.emit(event, data)
  }

  return { socket: socketRef.current, connected, emit }
}
