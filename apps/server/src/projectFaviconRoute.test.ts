import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  tryHandleProjectFaviconRequest,
  type ProjectFaviconRouteOptions,
} from "./projectFaviconRoute";

interface HttpResponse {
  statusCode: number;
  contentType: string | null;
  body: string;
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function withRouteServer(
  run: (baseUrl: string) => Promise<void>,
  options?: ProjectFaviconRouteOptions,
): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (tryHandleProjectFaviconRequest(url, res, options)) {
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected server address to be an object");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function request(baseUrl: string, pathname: string): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

describe("tryHandleProjectFaviconRequest", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 400 when cwd is missing", async () => {
    await withRouteServer(async (baseUrl) => {
      const response = await request(baseUrl, "/api/project-favicon");
      expect(response.statusCode).toBe(400);
      expect(response.body).toBe("Missing cwd parameter");
    });
  });

  it("serves a well-known favicon file from the project root", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-root-");
    fs.writeFileSync(path.join(projectDir, "favicon.svg"), "<svg>favicon</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>favicon</svg>");
    });
  });

  it("resolves icon href from source files when no well-known favicon exists", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-source-");
    const iconPath = path.join(projectDir, "public", "brand", "logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      '<link rel="icon" href="/brand/logo.svg">',
    );
    fs.writeFileSync(iconPath, "<svg>brand</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>brand</svg>");
    });
  });

  it("resolves icon link when href appears before rel in HTML", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-html-order-");
    const iconPath = path.join(projectDir, "public", "brand", "logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      '<link href="/brand/logo.svg" rel="icon">',
    );
    fs.writeFileSync(iconPath, "<svg>brand-html-order</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>brand-html-order</svg>");
    });
  });

  it("resolves object-style icon metadata when href appears before rel", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-obj-order-");
    const iconPath = path.join(projectDir, "public", "brand", "obj.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "src", "root.tsx"),
      'const links = [{ href: "/brand/obj.svg", rel: "icon" }];',
      "utf8",
    );
    fs.writeFileSync(iconPath, "<svg>brand-obj-order</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>brand-obj-order</svg>");
    });
  });

  it("serves a fallback favicon when no icon exists", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-fallback-");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toContain('data-fallback="project-favicon"');
    });
  });

  it("does not follow a symlinked favicon that points outside the project", async () => {
    const outsideDir = makeTempDir("t3code-favicon-route-outside-");
    const secretPath = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(secretPath, "OUTSIDE_SECRET", "utf8");
    const projectDir = makeTempDir("t3code-favicon-route-symlink-leaf-");
    fs.symlinkSync(secretPath, path.join(projectDir, "favicon.svg"));

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("OUTSIDE_SECRET");
      expect(response.body).toContain('data-fallback="project-favicon"');
    });
  });

  it("does not follow an icon href through a symlinked directory outside the project", async () => {
    const outsideDir = makeTempDir("t3code-favicon-route-outside-dir-");
    fs.writeFileSync(path.join(outsideDir, "secret.svg"), "OUTSIDE_DIR_SECRET", "utf8");
    const projectDir = makeTempDir("t3code-favicon-route-symlink-dir-");
    fs.symlinkSync(outsideDir, path.join(projectDir, "linkdir"));
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      '<link rel="icon" href="/linkdir/secret.svg">',
    );

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("OUTSIDE_DIR_SECRET");
      expect(response.body).toContain('data-fallback="project-favicon"');
    });
  });

  it("still serves a favicon when the project cwd itself is reached through a symlink", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-real-root-");
    fs.writeFileSync(path.join(projectDir, "favicon.svg"), "<svg>via-link</svg>", "utf8");
    const linkParent = makeTempDir("t3code-favicon-route-link-parent-");
    const linkedCwd = path.join(linkParent, "project-link");
    fs.symlinkSync(projectDir, linkedCwd);

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(linkedCwd)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("<svg>via-link</svg>");
    });
  });

  it("requires the auth token when one is configured", async () => {
    const projectDir = makeTempDir("t3code-favicon-route-token-");
    fs.writeFileSync(path.join(projectDir, "favicon.svg"), "<svg>token</svg>", "utf8");
    const cwdParam = `cwd=${encodeURIComponent(projectDir)}`;

    await withRouteServer(
      async (baseUrl) => {
        const missing = await request(baseUrl, `/api/project-favicon?${cwdParam}`);
        expect(missing.statusCode).toBe(401);
        expect(missing.body).not.toContain("<svg>token</svg>");

        const wrong = await request(baseUrl, `/api/project-favicon?${cwdParam}&token=nope`);
        expect(wrong.statusCode).toBe(401);

        const ok = await request(baseUrl, `/api/project-favicon?${cwdParam}&token=s3cret`);
        expect(ok.statusCode).toBe(200);
        expect(ok.body).toBe("<svg>token</svg>");
      },
      { authToken: "s3cret" },
    );
  });
});
