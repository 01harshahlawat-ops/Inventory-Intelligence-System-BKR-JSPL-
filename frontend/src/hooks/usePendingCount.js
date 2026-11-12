import { useEffect, useState } from 'react';
import api from '../services/api';

const POLL_INTERVAL_MS = 120000;
const MIN_VISIBILITY_GAP_MS = 60000;

export default function usePendingCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    let lastPollAt = 0;

    async function poll(force = false) {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      const now = Date.now();
      if (!force && lastPollAt && now - lastPollAt < MIN_VISIBILITY_GAP_MS) {
        return;
      }
      lastPollAt = now;
      try {
        const r = await api.get('/api/admin-approvals/?status=PENDING&limit=1');
        if (!mounted) return;

        // Use X-Total-Count if available from the backend response headers
        if (r.headers && r.headers['x-total-count']) {
           setCount(parseInt(r.headers['x-total-count'], 10));
        } else {
           setCount(r.data && r.data.length > 0 ? 1 : 0);
        }
      } catch (err) {
        // Ignore poll errors quietly
      }
    }

    function handleVisibilityChange() {
      if (typeof document !== 'undefined' && !document.hidden) {
        poll(false);
      }
    }

    poll(true);
    const t = setInterval(() => poll(false), POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      mounted = false;
      clearInterval(t);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, []);

  return count;
}
