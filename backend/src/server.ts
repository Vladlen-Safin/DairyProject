import express from "express";
import { config } from "./config.js";
import { importXmlHandler } from "./routes/importxml.js";

const app = express();

app.all("/importxml", importXmlHandler);

app.listen(config.port, () => {
  console.log(`ediary-backend слушает порт ${config.port}`);
});