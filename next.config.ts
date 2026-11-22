import type { NextConfig } from 'next';

// Nama repo GitHub (dipakai sebagai sub-alamat di GitHub Pages: https://<user>.github.io/<repo>/)
const REPO = 'Photobooth-WNI';
const onGitHub = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export', // hasil build = situs statis di folder "out"
  trailingSlash: true,
  basePath: onGitHub ? `/${REPO}` : '', // lokal (npm run dev) tetap di alamat biasa
};

export default nextConfig;
