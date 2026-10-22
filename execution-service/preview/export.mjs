import { constants } from "node:fs";
import { lstat, readdir, open } from "node:fs/promises";
import { readBounded } from "./read-file.mjs";

const files = [];
let totalBytes = 0;

// Reject observed symlinks and archives; the host independently bounds and validates all bytes.
async function collect(directory, prefix = "") {
  for (const name of await readdir(directory)) {
    const path = prefix ? `${prefix}/${name}` : name;
    const absolute = `${directory}/${name}`;
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("Symlink output rejected.");
    if (stat.isDirectory()) {
      if (path.length > 240) throw new Error("Output path too long.");
      await collect(absolute, path);
      continue;
    }
    if (!stat.isFile() || !/\.(html|js|css|json|txt|ico|png|jpg|jpeg|webp|woff2?)$/.test(path)) throw new Error("Unsupported output.");
    if (stat.size > 6 * 1024 * 1024 || files.length >= 200) throw new Error("Output too large.");
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      // A background process cannot turn a size check into an unbounded host response.
      if (!(await handle.stat()).isFile()) throw new Error("Non-regular output.");
      const buffer = await readBounded(handle, 6 * 1024 * 1024 - totalBytes);
      totalBytes += buffer.length;
      files.push({ path, content: buffer.toString("base64") });
    } finally {
      await handle.close();
    }
  }
}

const root = await lstat("/work/out");
if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Invalid export directory.");
await collect("/work/out");
process.stdout.write(JSON.stringify(files));
