import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on all interfaces so phones on the same Wi-Fi can connect
    allowedHosts: true, // allow access via tunnel hostnames (e.g. *.trycloudflare.com)
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
