
"use strict";
try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dir = process.env.DATA_DIR || path.join(__dirname, "data");
const file = path.join(dir, "officers.json");

const demo = [
  ["Electricity", "demo_electricity", "ElecDemo#2026"],
  ["Roads & transport", "demo_roads", "RoadsDemo#2026"],
  ["Water & sanitation", "demo_water", "WaterDemo#2026"],
  ["Health", "demo_health", "HealthDemo#2026"],
  ["Revenue & documents", "demo_revenue", "RevenueDemo#2026"],
  ["Other", "demo_other", "OtherDemo#2026"]
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

fs.mkdirSync(dir, { recursive: true });

let store = { version: 1, officers: [] };

if (fs.existsSync(file)) {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  store = Array.isArray(saved)
    ? { version: 1, officers: saved }
    : saved;
}

if (!store || !Array.isArray(store.officers)) {
  throw new Error("Invalid officers.json. No changes made.");
}

if (fs.existsSync(file)) {
  fs.copyFileSync(file, file + ".backup");
}

const now = new Date().toISOString();
let added = 0;

for (const [department, username, password] of demo) {
  if (store.officers.some(
    o => String(o.username || "").toLowerCase() === username
  )) {
    console.log("Already exists:", username);
    continue;
  }

  store.officers.push({
    id: "off-demo-" + crypto.randomBytes(10).toString("hex"),
    username,
    fullName: "Demo " + department + " Officer",
    department,
    role: "officer",
    email: "",
    active: true,
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now
  });

  console.log("Created:", username);
  added++;
}

const temp = file + ".tmp";
fs.writeFileSync(temp, JSON.stringify(store, null, 2));
fs.renameSync(temp, file);

console.log(`Finished. ${added} demo account(s) added.`);
console.log("Stop and restart the server before logging in.");
