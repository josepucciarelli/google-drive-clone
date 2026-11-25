import type { NextConfig } from "next";

// File thumbnails are served from your Appwrite region's host
const appwriteHost = new URL(
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "https://nyc.cloud.appwrite.io/v1",
).hostname;

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "100MB",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.pixabay.com",
      },
      {
        protocol: "https",
        hostname: "img.freepik.com",
      },
      {
        protocol: "https",
        hostname: appwriteHost,
      },
    ],
  },
};

export default nextConfig;
