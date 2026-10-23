// Run: npm test   (uses a fake Gemini server, no real key needed)
const http = require("http"), os = require("os"), fs = require("fs"), path = require("path"), assert = require("assert");
(async () => {
  let geminiMode = "ok", lastBody = "";
  const fake = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      lastBody = b;
      if (geminiMode === "fail") { res.writeHead(500); return res.end("boom"); }
      const hindiDanger = /तार/.test(b);
      const out = { sentiment: "Negative", summary: "Test summary", safety_risk: hindiDanger, safety_reason: hindiDanger ? "Hanging electric wire reported" : "",
        repeat_complaint: false, critical_timeline: false, routine_status_check: false, suggested_reply: "We are looking into it." };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
    });
  }).listen(0);
  await new Promise((r) => fake.on("listening", r));
  process.env.GEMINI_API_KEY = "test"; process.env.OFFICER_PIN = "9999";
  process.env.GEMINI_BASE_URL = "http://127.0.0.1:" + fake.address().port;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gai-"));
  const { app, seed } = require("./server.js");
  await seed();
  const srv = app.listen(0); const base = "http://127.0.0.1:" + srv.address().port;
  const call = async (m, u, body, tok) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ok = (n) => console.log("  ok -", n);

  let r = await call("POST", "/api/analyze", { text: "A damaged live wire is blocking the main road." });
  assert.equal(r.j.p, "P1"); assert.equal(r.j.source, "gemini"); ok("analyze: safety rule + gemini");
  r = await call("POST", "/api/analyze", { text: "सड़क पर बिजली का तार टूटा पड़ा है" });
  assert.equal(r.j.p, "P1"); ok("analyze: Gemini catches a Hindi danger the rules miss");
  r = await call("POST", "/api/analyze", { text: "mail me a@b.com or 9876543210" });
  assert(!/a@b\.com|9876543210/.test(lastBody)); ok("email/phone are masked before reaching Gemini");
  geminiMode = "fail";
  r = await call("POST", "/api/analyze", { text: "Please tell me my application status." });
  assert.equal(r.j.p, "P4"); assert.equal(r.j.source, "rules"); ok("falls back to rules when Gemini fails");
  geminiMode = "ok";
  assert.equal((await call("POST", "/api/analyze", {})).s, 400); ok("empty analyze rejected");

  r = await call("POST", "/api/complaints", { title: "Open manhole", description: "Open manhole near school. Call 9876543210", department: "Roads & transport", location: "Ward 2", ageDays: 3, contact: "me@x.com" });
  assert.equal(r.s, 201); const id = r.j.id; assert.equal(r.j.p, undefined); ok("submit complaint -> " + id);
  r = await call("GET", "/api/complaints/" + id.toLowerCase());
  assert.equal(r.j.status, "Submitted"); assert.equal(r.j.contact, undefined); assert.equal(r.j.p, undefined); ok("public tracking exposes no internal data");
  assert.equal((await call("GET", "/api/complaints/GAI-0")).s, 404); ok("unknown ID -> 404");
  assert.equal((await call("POST", "/api/complaints", { title: "x" })).s, 400); ok("missing description rejected");

  assert.equal((await call("GET", "/api/officer/complaints")).s, 401); ok("officer API needs sign-in");
  assert.equal((await call("POST", "/api/login", { username: "superadmin", password: "bad" })).s, 401); ok("wrong password rejected");
  assert.equal((await call("POST", "/api/login", { pin: "9999" })).s, 401); ok("shared-PIN login is no longer accepted");
  const tok = (await call("POST", "/api/login", { username: "superadmin", password: "9999" })).j.token; assert(tok); ok("administrator signs in with unique username and password");
  r = await call("GET", "/api/officer/complaints", null, tok);
  assert(r.j.complaints.length >= 4); assert.equal(r.j.complaints[0].p, "P1");
  const mine = r.j.complaints.find((c) => c.id === id);
  assert.equal(mine.contact, "me@x.com"); assert(!mine.desc.includes("9876543210")); ok("admin can view scoped contact; phone is masked in complaint text");
  assert.equal((await call("GET", "/api/officer/complaints?priority=P4", null, tok)).j.complaints.every((c) => c.p === "P4"), true); ok("filters work");
  r = await call("PATCH", "/api/officer/complaints/" + id, { priority: "P2", status: "Resolved", reply: "Fixed." }, tok);
  assert.equal(r.j.p, "P2"); assert.equal(r.j.approved, true); assert(r.j.log.includes("Priority changed by officer to P2")); ok("officer decision saved + logged");
  assert.equal((await call("PATCH", "/api/officer/complaints/" + id, { priority: "P9" }, tok)).s, 400); ok("invalid priority rejected");
  r = await call("GET", "/api/complaints/" + id); assert.equal(r.j.reply, "Fixed."); ok("citizen sees officer reply");
  r = await call("GET", "/api/officer/stats", null, tok); assert.equal(r.j.overridden, 1); assert(r.j.resolved >= 1); ok("admin stats cover all departments");

  // Admin-only account creation and strict department scoping.
  assert.equal((await call("GET", "/api/admin/officers")).s, 401); ok("officer management requires sign-in");
  const created = await call("POST", "/api/admin/officers", { department: "Roads & transport", fullName: "Roads Test Officer", username: "roads_test", email: "roads@example.gov.in", password: "StrongPass123" }, tok);
  assert.equal(created.s, 201); const roadsOfficerId = created.j.officer.id; assert.equal(created.j.officer.role, "officer"); assert.equal(created.j.officer.username, "roads_test"); assert.equal(created.j.officer.passwordHash, undefined); ok("admin creates department-specific account without returning hashes");
  r = await call("GET", "/api/admin/officers", null, tok); assert(r.j.officers.some((o) => o.id === roadsOfficerId)); assert(!JSON.stringify(r.j).includes("passwordHash")); ok("admin officer list returns safe account fields only");
  const roadsToken = (await call("POST", "/api/login", { username: "roads_test", password: "StrongPass123" })).j.token; assert(roadsToken); ok("department officer signs in with unique credentials");
  r = await call("GET", "/api/me", null, roadsToken); assert.equal(r.j.department, "Roads & transport"); assert.equal(r.j.role, "officer"); ok("session identifies role and department");
  r = await call("GET", "/api/officer/complaints", null, roadsToken); assert(r.j.complaints.every((c) => c.dept === "Roads & transport")); assert(!r.j.complaints.some((c) => c.id === "GAI-1001")); assert(r.j.complaints.some((c) => c.id === id && c.contact === "me@x.com")); ok("department officer sees only their department complaints and relevant contact details");
  assert.equal((await call("GET", "/api/officer/complaints/GAI-1001", null, roadsToken)).s, 404); ok("cross-department complaint detail is blocked");
  assert.equal((await call("PATCH", "/api/officer/complaints/GAI-1001", { status: "Resolved" }, roadsToken)).s, 404); ok("cross-department edits are blocked server-side");
  r = await call("GET", "/api/officer/stats", null, roadsToken); assert.equal(r.j.total, (await call("GET", "/api/officer/complaints", null, roadsToken)).j.complaints.length); ok("department analytics are scoped");

  const generated = await call("POST", "/api/admin/officers", { department: "Electricity", fullName: "Generated Password Officer", username: "elec_generated" }, tok);
  assert.equal(generated.s, 201); assert(generated.j.generatedPassword.length >= 8); const generatedId = generated.j.officer.id;
  const officersFile = path.join(process.env.DATA_DIR, "officers.json");
  let officerDisk = JSON.parse(fs.readFileSync(officersFile, "utf8")); assert(officerDisk.officers.some((o) => o.username === "elec_generated" && o.passwordHash && !JSON.stringify(o).includes(generated.j.generatedPassword))); ok("accounts persist in officers.json as password hashes");
  r = await call("POST", "/api/admin/officers/" + generatedId + "/reset-password", { password: "ResetPassword123" }, tok); assert.equal(r.s, 200); assert.equal(r.j.generatedPassword, undefined); ok("admin can instantly set a replacement password");
  r = await call("POST", "/api/login", { username: "elec_generated", password: "ResetPassword123" }); assert.equal(r.s, 200); ok("password reset takes effect immediately");
  assert.equal((await call("PATCH", "/api/admin/officers/" + generatedId + "/status", { active: false }, tok)).s, 200); assert.equal((await call("POST", "/api/login", { username: "elec_generated", password: "ResetPassword123" })).s, 401); ok("deactivation revokes future logins");
  assert.equal((await call("DELETE", "/api/admin/officers/" + generatedId, null, tok)).s, 200); officerDisk = JSON.parse(fs.readFileSync(officersFile, "utf8")); assert(!officerDisk.officers.some((o) => o.id === generatedId)); ok("deleted account is removed from officers.json");
  const persisted = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "db.json"), "utf8")); assert(persisted.complaints.some((c) => c.id === id)); ok("complaint data persisted to disk");

  // Citizen accounts: separate from officer accounts.
  assert.equal((await call("GET", "/api/citizen/me")).s, 401); ok("citizen profile needs sign-in");
  assert.equal((await call("POST", "/api/citizen/register", { fullName: "Asha Verma", mobile: "12345", password: "CitizenPass1" })).s, 400); ok("invalid mobile number rejected");
  r = await call("POST", "/api/citizen/register", { fullName: "Asha Verma", mobile: "+91 98765-43210", email: "Asha@Example.com", ward: "Ward 7", password: "CitizenPass1" });
  assert.equal(r.s, 201); assert(r.j.token); assert.equal(r.j.citizen.mobile, "9876543210"); assert.equal(r.j.citizen.email, "asha@example.com"); assert.equal(r.j.citizen.passwordHash, undefined); ok("citizen registers with basic details and no hash is returned");
  const citTok = r.j.token;
  assert.equal((await call("POST", "/api/citizen/register", { fullName: "Other", mobile: "9876543210", password: "CitizenPass1" })).s, 409); ok("duplicate mobile rejected");
  assert.equal((await call("POST", "/api/citizen/register", { fullName: "Other", mobile: "9123456789", email: "asha@example.com", password: "CitizenPass1" })).s, 409); ok("duplicate email rejected");
  assert.equal((await call("POST", "/api/citizen/register", { fullName: "Other", mobile: "9123456789", password: "short" })).s, 400); ok("short password rejected");
  r = await call("GET", "/api/citizen/me", null, citTok); assert.equal(r.s, 200); assert.equal(r.j.fullName, "Asha Verma"); assert.equal(r.j.ward, "Ward 7"); ok("registration session identifies the citizen");
  assert.equal((await call("POST", "/api/citizen/login", { identifier: "9876543210", password: "wrong-pass" })).s, 401); ok("citizen wrong password rejected");
  assert.equal((await call("POST", "/api/citizen/login", { identifier: "9999999999", password: "CitizenPass1" })).s, 401); ok("unknown citizen rejected");
  r = await call("POST", "/api/citizen/login", { identifier: "98765 43210", password: "CitizenPass1" }); assert.equal(r.s, 200); assert(r.j.token); ok("citizen signs in with mobile number");
  const citTok2 = (await call("POST", "/api/citizen/login", { identifier: "ASHA@example.com", password: "CitizenPass1" })).j.token; assert(citTok2); ok("citizen signs in with email");
  assert.equal((await call("GET", "/api/officer/complaints", null, citTok)).s, 401); ok("citizen token cannot open officer APIs");
  assert.equal((await call("GET", "/api/admin/officers", null, citTok)).s, 401); ok("citizen token cannot open admin APIs");
  assert.equal((await call("GET", "/api/citizen/me", null, tok)).s, 401); ok("officer token cannot open citizen APIs");
  assert.equal((await call("POST", "/api/citizen/logout", null, citTok)).s, 200); assert.equal((await call("GET", "/api/citizen/me", null, citTok)).s, 401); ok("citizen sign-out revokes the session");
  const citDisk = fs.readFileSync(path.join(process.env.DATA_DIR, "citizens.json"), "utf8"); assert(citDisk.includes("scrypt$") && !citDisk.includes("CitizenPass1")); ok("citizen passwords persist only as hashes");
  assert.equal((await fetch(base + "/")).status, 200); ok("frontend served");
  console.log("\nAll tests passed."); srv.close(); fake.close(); process.exit(0);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
