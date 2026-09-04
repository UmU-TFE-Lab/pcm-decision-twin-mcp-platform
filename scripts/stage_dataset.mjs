import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceArgument = process.argv[2];

if (!sourceArgument) {
  process.stderr.write("Usage: npm run data:stage -- /path/to/pcm_thermal_storage.csv\n");
  process.exit(1);
}

const source = path.resolve(root, sourceArgument);
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
  process.stderr.write(`Dataset file not found: ${source}\n`);
  process.exit(1);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "release_manifest.json"), "utf8"),
);
const bytes = fs.readFileSync(source);
const digest = crypto.createHash("sha256").update(bytes).digest("hex");

if (digest !== manifest.dataset.sha256) {
  process.stderr.write(
    `Dataset checksum mismatch. Expected ${manifest.dataset.sha256}, received ${digest}.\n`,
  );
  process.exit(1);
}

const rootTarget = path.join(root, "pcm_thermal_storage.csv");
const publicTarget = path.join(root, "public", "pcm_thermal_storage.csv");
fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
fs.writeFileSync(rootTarget, bytes);
fs.writeFileSync(publicTarget, bytes);

process.stdout.write(
  `Dataset staged at pcm_thermal_storage.csv and public/pcm_thermal_storage.csv\nSHA-256: ${digest}\n`,
);
