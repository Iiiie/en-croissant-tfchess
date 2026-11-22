/// <reference types="vitest/config" />
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import * as os from "node:os";

const isDebug = !!process.env.TAURI_ENV_DEBUG;
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        tanstackRouter({
            target: "react",
        }),
        react({ compiler: true }),
    ],
    server: {
        port: 1420,
        strictPort: true,
        // Bind explicitly to IPv4 loopback. With `false`/`localhost`, Node can
        // bind only to `[::1]`, while WebKitGTK resolves `localhost` to
        // 127.0.0.1 and then every request fails with
        // "WebKit encountered an internal error ... internallyFailedLoadTimerFired".
        host: host || "127.0.0.1",
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: 1421,
              }
            : undefined,
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
    build: {
        minify: isDebug ? false : "esbuild",
        sourcemap: isDebug ? "inline" : false,
        target: process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, "index.html"),
                intermission: resolve(import.meta.dirname, "intermission.html"),
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "./src"),
        },
    },
    test: {
        environment: "jsdom",
    },
    define: {
        "import.meta.env.VITE_PLATFORM": JSON.stringify(os.platform()),
    },
});
