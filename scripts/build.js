const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const srcFile = path.join(rootDir, "src", "index.js");
const distDir = path.join(rootDir, "dist");
const distFile = path.join(distDir, "index.js");

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(srcFile, distFile);

console.log(`Built ${path.relative(rootDir, distFile)}`);
