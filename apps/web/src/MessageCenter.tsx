import { useEffect, useRef, useState } from 'react';
import { type AppMessage, messageEvent } from './api/client.js';

const timeoutMs = 3200;

export function MessageCenter() {
  const [message, setMessage] = useState<AppMessage | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const handleMessage = (event: Event) => {
      const detail = (event as CustomEvent<AppMessage>).detail;
      if (!detail?.text) return;
      if (timer.current) window.clearTimeout(timer.current);
      setMessage(detail);
      timer.current = window.setTimeout(() => setMessage(null), timeoutMs);
    };
    window.addEventListener(messageEvent, handleMessage);
    return () => {
      window.removeEventListener(messageEvent, handleMessage);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return message && <p className={`workspace-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>;
}
