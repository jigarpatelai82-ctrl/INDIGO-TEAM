// server.ts — Entry point for dev server and Cloud Run container
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
// Import the core Express backend app
const backendApp = require("./backend/app");
const db = require("./backend/db");

const PORT = 3000;

async function startServer() {
  const app = express();

  // Try to initialize schema if DATABASE_URL is available
  if (process.env.DATABASE_URL) {
    try {
      await db.initSchema();
      console.log("PostgreSQL database connected & schema verified.");
    } catch (err: any) {
      console.warn("Notice: Database initialization deferred:", err.message);
    }
  }

  // Mount backend API routes & middleware
  app.use(backendApp);

  // In development mode, mount Vite middleware for any other assets
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      // Fallback to static serving
      app.use(express.static(path.join(__dirname, "frontend")));
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use(express.static(path.join(process.cwd(), "frontend")));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "Not found" });
      }
      res.sendFile(path.join(process.cwd(), "frontend", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`INDIGO TEAM running on http://localhost:${PORT}`);
  });
}

startServer();
