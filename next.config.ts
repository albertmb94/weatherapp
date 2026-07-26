import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Idempotent MapReady guard in MapPicker.tsx makes React 19 Strict Mode
  // (double-invokes effects in dev) safe with react-leaflet.
  reactStrictMode: true,
};

export default nextConfig;
