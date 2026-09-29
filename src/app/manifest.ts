import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WACRM — WhatsApp CRM',
    short_name: 'WACRM',
    description: 'Shared inbox, WhatsApp automation, broadcasts, and AI agent for lead management.',
    start_url: '/inbox',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#7c3aed',
    orientation: 'portrait-primary',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
