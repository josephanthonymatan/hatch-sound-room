import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "react", test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
  server: {
    proxy: {
      "/auth": "http://127.0.0.1:3001",
      "/api/hatch": "http://127.0.0.1:3001",
    },
  },
});
