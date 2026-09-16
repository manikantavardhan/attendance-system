const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_FOR_PRODUCTION";
const db = new Database(path.join(__dirname, "attendance.db"));

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  roll_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Present','Absent')),
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE(student_id, attendance_date)
);
`);

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM students").get().c;
  if (count === 0) {
    const add = db.prepare("INSERT INTO students(name, roll_number, password_hash) VALUES(?,?,?)");
    add.run("Manikanta", "23A81A0501", bcrypt.hashSync("23A81A0501", 10));
    add.run("Jaswanth", "23A81A0502", bcrypt.hashSync("23A81A0502", 10));
  }
  const adminExists = db.prepare("SELECT id FROM students WHERE roll_number = ?").get("__ADMIN__");
  if (!adminExists) {
    // Admin is kept outside the students table through environment/default credentials.
  }
}
seed();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function sign(user) {
  return jwt.sign({ id: user.id, name: user.name, roll: user.roll_number, role: "student" }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  try {
    const token = req.cookies.attendease;
    if (!token) return res.status(401).json({ error: "Please login." });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please login again." });
  }
}
function admin(req, res, next) {
  const u = req.cookies.admin_attendease;
  if (u !== "1") return res.status(401).json({ error: "Admin login required." });
  next();
}
function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

app.post("/api/login", (req,res) => {
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  if (!name || !password) return res.status(400).json({error:"Enter username and password."});
  const user = db.prepare("SELECT * FROM students WHERE name = ?").get(name);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({error:"Invalid username or password."});
  res.cookie("attendease", sign(user), {httpOnly:true, sameSite:"lax", secure:false, maxAge:7*24*60*60*1000});
  res.json({ok:true, user:{name:user.name, roll:user.roll_number}});
});

app.post("/api/admin-login", (req,res) => {
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  const adminName = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  if (name === adminName && password === adminPassword) {
    res.cookie("admin_attendease","1",{httpOnly:true,sameSite:"lax",secure:false,maxAge:7*24*60*60*1000});
    return res.json({ok:true});
  }
  res.status(401).json({error:"Invalid admin login."});
});

app.post("/api/logout",(req,res)=>{
  res.clearCookie("attendease"); res.clearCookie("admin_attendease"); res.json({ok:true});
});

function summary(studentId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) total,
      COALESCE(SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END),0) present,
      COALESCE(SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END),0) absent
    FROM attendance WHERE student_id=?
  `).get(studentId);
  const percentage = row.total ? Number((row.present / row.total * 100).toFixed(2)) : 0;
  return {...row, percentage};
}

app.get("/api/me", auth, (req,res)=>{
  const s = db.prepare("SELECT id,name,roll_number FROM students WHERE id=?").get(req.user.id);
  if (!s) return res.status(401).json({error:"Student not found."});
  res.json({user:{name:s.name,roll:s.roll_number}, summary:summary(s.id)});
});

app.get("/api/my-attendance", auth, (req,res)=>{
  const rows = db.prepare("SELECT attendance_date,status,marked_at FROM attendance WHERE student_id=? ORDER BY attendance_date DESC").all(req.user.id);
  res.json({rows});
});

app.post("/api/my-attendance", auth, (req,res)=>{
  const date = String(req.body.date || "");
  const status = String(req.body.status || "");
  if (!validDate(date) || !["Present","Absent"].includes(status))
    return res.status(400).json({error:"Invalid date or status."});
  try {
    db.prepare("INSERT INTO attendance(student_id,attendance_date,status) VALUES(?,?,?)").run(req.user.id,date,status);
    res.json({ok:true, summary:summary(req.user.id)});
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({error:"Attendance is already marked for this date."});
    res.status(500).json({error:"Could not save attendance."});
  }
});

app.get("/api/class-overview", auth, (req,res)=>{
  const students = db.prepare("SELECT id,name,roll_number FROM students ORDER BY name").all();
  res.json({students:students.map(s=>({name:s.name,roll:s.roll_number,...summary(s.id)}))});
});

app.post("/api/change-password", auth, (req,res)=>{
  const oldPassword=String(req.body.oldPassword||""), newPassword=String(req.body.newPassword||"");
  if(newPassword.length<6) return res.status(400).json({error:"New password must be at least 6 characters."});
  const s=db.prepare("SELECT * FROM students WHERE id=?").get(req.user.id);
  if(!bcrypt.compareSync(oldPassword,s.password_hash)) return res.status(401).json({error:"Current password is incorrect."});
  db.prepare("UPDATE students SET password_hash=? WHERE id=?").run(bcrypt.hashSync(newPassword,10),s.id);
  res.json({ok:true});
});

app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));

app.get("/api/admin/students", admin, (req,res)=>{
  const rows=db.prepare("SELECT id,name,roll_number,created_at FROM students ORDER BY name").all();
  res.json({rows});
});
app.post("/api/admin/students", admin, (req,res)=>{
  const name=String(req.body.name||"").trim(), roll=String(req.body.roll||"").trim(), password=String(req.body.password||roll);
  if(!name||!roll||password.length<6) return res.status(400).json({error:"Name, roll number and a password of at least 6 characters are required."});
  try {
    db.prepare("INSERT INTO students(name,roll_number,password_hash) VALUES(?,?,?)").run(name,roll,bcrypt.hashSync(password,10));
    res.json({ok:true});
  } catch(e) {
    if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"That roll number already exists."});
    res.status(500).json({error:"Could not add student."});
  }
});
app.get("/api/admin/attendance", admin, (req,res)=>{
  const rows=db.prepare(`SELECT a.id,a.attendance_date,a.status,a.marked_at,s.name,s.roll_number
    FROM attendance a JOIN students s ON s.id=a.student_id
    ORDER BY a.attendance_date DESC,s.name`).all();
  res.json({rows});
});
app.patch("/api/admin/attendance/:id", admin, (req,res)=>{
  const status=String(req.body.status||"");
  if(!["Present","Absent"].includes(status)) return res.status(400).json({error:"Invalid status."});
  db.prepare("UPDATE attendance SET status=? WHERE id=?").run(status,req.params.id);
  res.json({ok:true});
});

app.get("*", (req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT, "0.0.0.0", ()=>console.log(`AttendEase running at http://localhost:${PORT}`));
