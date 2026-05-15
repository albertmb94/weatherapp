import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Strict Mode double-invokes effects in dev, which breaks Leaflet's
  // MapContainer ("Map container is being reused by another instance").
  // We keep production semantics intact while avoiding the dev-only error.
  reactStrictMode: false,
};

export default nextConfig;
