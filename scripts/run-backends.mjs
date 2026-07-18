import { spawn } from "node:child_process";
import path from "node:path";

const nxBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "nx.cmd" : "nx"
);

const services = [
  {
    name: "gateway:8080",
    port: "8080",
    args: ["serve", "@e-commerce-bg/E-Commerce-BG"],
  },
  {
    name: "product:8181",
    port: "8181",
    args: ["serve", "@e-commerce-bg/product-service"],
  },
  {
    name: "order:8282",
    port: "8282",
    args: ["serve", "@e-commerce-bg/order-service"],
  },
  {
    name: "admin:8383",
    port: "8383",
    args: ["serve", "@e-commerce-bg/admin-service"],
  },
  {
    name: "chatting:8484",
    port: "8484",
    args: ["serve", "@e-commerce-bg/chatting-service"],
  },
  {
    name: "logger:8585",
    port: "8585",
    args: ["serve", "@e-commerce-bg/logger-service"],
  },
  {
    name: "recommendation:8686",
    port: "8686",
    args: ["serve", "@e-commerce-bg/recommendation-service"],
  },
];

const children = new Map();
let shuttingDown = false;

const prefixOutput = (name, chunk, writer) => {
  const lines = chunk.toString().split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line && index === lines.length - 1) {
      return;
    }

    writer(`[${name}] ${line}\n`);
  });
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children.values()) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }

  setTimeout(() => {
    for (const child of children.values()) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    process.exit(exitCode);
  }, 1500);
};

for (const service of services) {
  const child = spawn(nxBin, service.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: service.port,
      FORCE_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.set(service.name, child);

  child.stdout.on("data", (chunk) =>
    prefixOutput(service.name, chunk, process.stdout.write.bind(process.stdout))
  );
  child.stderr.on("data", (chunk) =>
    prefixOutput(service.name, chunk, process.stderr.write.bind(process.stderr))
  );

  child.on("exit", (code, signal) => {
    children.delete(service.name);

    if (!shuttingDown && code !== 0) {
      console.error(
        `[${service.name}] exited with ${signal || `code ${code}`}. Other backends will keep running.`
      );
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
