import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Idempotent MapReady guard in MapPicker.tsx makes React 19 Strict Mode
  // (double-invokes effects in dev) safe with react-leaflet.
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/api/sw",
        headers: [
          // Always serve the latest SW so a new deploy immediately
          // purges the old offline cache.
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
