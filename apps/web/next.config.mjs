/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared db package ships TypeScript, so Next must compile it.
  transpilePackages: ['@catwalks/db'],
  // Railway builds from the repo root; standalone keeps the image small.
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
};
export default nextConfig;
