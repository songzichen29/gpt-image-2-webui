import type { NextConfig } from 'next';

const noStoreHtmlHeaders = [
    {
        key: 'Cache-Control',
        value: 'private, no-cache, no-store, max-age=0, must-revalidate'
    }
];

const nextConfig: NextConfig = {
    output: 'standalone',
    images: {
        unoptimized: true
    },
    async headers() {
        return [
            {
                source: '/',
                headers: noStoreHtmlHeaders
            },
            {
                source: '/history',
                headers: noStoreHtmlHeaders
            },
            {
                source: '/history/:path*',
                headers: noStoreHtmlHeaders
            }
        ];
    }
};

export default nextConfig;
