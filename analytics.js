// Import Vercel Analytics from CDN
import { inject } from 'https://esm.sh/@vercel/analytics@1';

// Initialize Vercel Web Analytics
inject({
  mode: 'auto',
  debug: false
});
