'use client';
import { useEffect } from 'react';

/** Registers the service worker (only possible over HTTPS or on localhost). */
export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, []);
  return null;
}
