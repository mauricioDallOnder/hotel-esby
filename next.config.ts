import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

// Inherited by build workers; both browser and server receive the same literal.
const buildVersion = process.env.HOTEL_BUILD_VERSION ||= randomUUID();

const nextConfig: NextConfig = {
  generateBuildId: async () => buildVersion,
  env: { NEXT_PUBLIC_HOTEL_BUILD_VERSION: buildVersion },
    allowedDevOrigins: ['10.123.200.127'],
};

export default nextConfig;
