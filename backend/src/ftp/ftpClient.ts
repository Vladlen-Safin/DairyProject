import { importStep } from "../import/diagnostics.js";
import { Client, FileInfo } from "basic-ftp";
import { config } from "../config.js";

export async function withFtpClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(30_000); // таймаут операций 30 сек
  client.ftp.verbose = process.env.FTP_VERBOSE === "true";

  try {
    await importStep("ftp.connect", () => client.access({
      host: config.ftp.host,
      port: config.ftp.port,
      user: config.ftp.user,
      password: config.ftp.password,
      secure: config.ftp.secure,
    }), { host: config.ftp.host, port: config.ftp.port, secure: config.ftp.secure });

    if (config.ftp.remoteDir && config.ftp.remoteDir !== "/") {
      await importStep("ftp.cd", () => client.cd(config.ftp.remoteDir), { remoteDir: config.ftp.remoteDir });
    }

    return await fn(client);
  } finally {
    client.close();
  }
}

export async function listRemoteFiles(): Promise<FileInfo[]> {
  return withFtpClient((client) => client.list());
}