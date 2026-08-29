import express from "express";
import { config } from "./config.js";
import { importXmlHandler } from "./routes/importxml.js";
import { readRouter } from "./routes/read.js";
import { authRouter } from "./routes/auth.js";

const app = express();

app.use(express.json());

// CORS для локальной разработки фронтенда (ng serve на :4200)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Обмен с 1С
app.all("/importxml", importXmlHandler);

// Демо-авторизация фронтенда
app.use("/api/auth", authRouter);

// Read-API для фронтенда
app.use("/api", readRouter);

app.get("/", (_req, res) => res.type("text/plain").send("ediary-backend"));

app.listen(config.port, () => {
  console.log(`ediary-backend слушает порт ${config.port}`);
});
