import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/inbox',
    name: 'LeadPilot — The Lead-to-Booking System',
    short_name: 'LeadPilot',
    description: 'The Lead-to-Booking System for Coaches, Consultants & Trainers.',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#7c3aed',
    orientation: 'portrait-primary',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
