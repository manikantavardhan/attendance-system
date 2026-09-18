const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 10000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "attendance.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  roll_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Present','Absent')),
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, attendance_date),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS faculty (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Faculty',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const now = () => new Date().toISOString();
const safeStudent = s => ({id:s.id,name:s.name,roll_number:s.roll_number,created_at:s.created_at});

if (!db.prepare("SELECT 1 FROM faculty LIMIT 1").get())
  db.prepare("INSERT INTO faculty(username,password,name) VALUES(?,?,?)").run("admin",hash("admin123"),"Faculty Admin");

if (!db.prepare("SELECT 1 FROM students WHERE roll_number=?").get("25Q71AO521"))
  db.prepare("INSERT INTO students(name,roll_number,password) VALUES(?,?,?)").run("Manikanta","25Q71AO521",hash("25Q71AO521"));

function studentFromReq(req) {
  const id = Number(req.cookies.student_id || 0);
  return id ? db.prepare("SELECT * FROM students WHERE id=?").get(id) : null;
}
function facultyFromReq(req) {
  const id = Number(req.cookies.faculty_id || 0);
  return id ? db.prepare("SELECT * FROM faculty WHERE id=?").get(id) : null;
}
function studentRequired(req,res,next){ if(!studentFromReq(req)) return res.status(401).json({error:"Student login required"}); next(); }
function facultyRequired(req,res,next){ if(!facultyFromReq(req)) return res.status(401).json({error:"Faculty login required"}); next(); }

app.use(express.static(path.join(__dirname,"public")));

app.post("/api/login", (req,res)=>{
  const {mode="student", username="", password=""}=req.body||{};
  if(mode==="faculty"){
    const f=db.prepare("SELECT * FROM faculty WHERE username=? AND password=?").get(username.trim(),hash(password));
    if(!f) return res.status(401).json({error:"Invalid faculty username or password"});
    res.cookie("faculty_id",String(f.id),{httpOnly:true,sameSite:"lax"});
    return res.json({ok:true,role:"faculty",name:f.name});
  }
  const s=db.prepare("SELECT * FROM students WHERE name=? AND password=?").get(username.trim(),hash(password));
  if(!s) return res.status(401).json({error:"Invalid student name or roll number"});
  res.cookie("student_id",String(s.id),{httpOnly:true,sameSite:"lax"});
  res.json({ok:true,role:"student",student:safeStudent(s)});
});

app.post("/api/logout",(req,res)=>{
  res.clearCookie("student_id"); res.clearCookie("faculty_id"); res.json({ok:true});
});

app.get("/api/me", (req,res)=>{
  const s=studentFromReq(req), f=facultyFromReq(req);
  if(s) return res.json({role:"student",student:safeStudent(s)});
  if(f) return res.json({role:"faculty",faculty:{id:f.id,username:f.username,name:f.name}});
  res.status(401).json({error:"Not logged in"});
});

app.get("/api/my-attendance",studentRequired,(req,res)=>{
  const s=studentFromReq(req);
  const rows=db.prepare("SELECT id,attendance_date,status,marked_at FROM attendance WHERE student_id=? ORDER BY attendance_date DESC").all(s.id);
  const total=rows.length, attended=rows.filter(x=>x.status==="Present").length, absent=total-attended;
  res.json({student:safeStudent(s),summary:{total,attended,absent,percentage:total?Number((attended/total*100).toFixed(2)):0},history:rows});
});

app.post("/api/attendance",studentRequired,(req,res)=>{
  const s=studentFromReq(req);
  const date=(req.body.date||today()).slice(0,10);
  const status=req.body.status==="Absent"?"Absent":"Present";
  const old=db.prepare("SELECT * FROM attendance WHERE student_id=? AND attendance_date=?").get(s.id,date);
  if(old) return res.status(409).json({error:"Attendance already marked for this date",record:old});
  const info=db.prepare("INSERT INTO attendance(student_id,attendance_date,status,marked_at) VALUES(?,?,?,?)").run(s.id,date,status,now());
  res.json({ok:true,id:info.lastInsertRowid});
});

app.put("/api/my-profile",studentRequired,(req,res)=>{
  const s=studentFromReq(req);
  const name=String(req.body.name||s.name).trim();
  const roll=String(req.body.roll_number||s.roll_number).trim();
  if(!name||!roll) return res.status(400).json({error:"Name and roll number are required"});
  try {
    db.prepare("UPDATE students SET name=?,roll_number=? WHERE id=?").run(name,roll,s.id);
    if(req.body.new_password) db.prepare("UPDATE students SET password=? WHERE id=?").run(hash(req.body.new_password),s.id);
    res.json({ok:true,student:safeStudent(db.prepare("SELECT * FROM students WHERE id=?").get(s.id))});
  } catch(e){res.status(400).json({error:"Roll number already exists"});}
});

/* FACULTY: student/member management */
app.get("/api/faculty/students",facultyRequired,(req,res)=>{
  const rows=db.prepare(`
    SELECT s.id,s.name,s.roll_number,s.created_at,
      COUNT(a.id) total,
      SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END) attended,
      SUM(CASE WHEN a.status='Absent' THEN 1 ELSE 0 END) absent
    FROM students s LEFT JOIN attendance a ON a.student_id=s.id
    GROUP BY s.id ORDER BY s.name COLLATE NOCASE
  `).all().map(x=>({...x,total:Number(x.total||0),attended:Number(x.attended||0),absent:Number(x.absent||0),percentage:x.total?Number((x.attended/x.total*100).toFixed(2)):0}));
  res.json({students:rows});
});

app.post("/api/faculty/students",facultyRequired,(req,res)=>{
  const name=String(req.body.name||"").trim(), roll=String(req.body.roll_number||"").trim();
  const password=String(req.body.password||roll).trim();
  if(!name||!roll) return res.status(400).json({error:"Name and roll number are required"});
  try{
    const info=db.prepare("INSERT INTO students(name,roll_number,password) VALUES(?,?,?)").run(name,roll,hash(password));
    res.json({ok:true,student:safeStudent(db.prepare("SELECT * FROM students WHERE id=?").get(info.lastInsertRowid))});
  }catch(e){res.status(400).json({error:"Roll number already exists"});}
});

app.put("/api/faculty/students/:id",facultyRequired,(req,res)=>{
  const id=Number(req.params.id);
  const old=db.prepare("SELECT * FROM students WHERE id=?").get(id);
  if(!old) return res.status(404).json({error:"Student not found"});
  const name=String(req.body.name??old.name).trim();
  const roll=String(req.body.roll_number??old.roll_number).trim();
  try{
    db.prepare("UPDATE students SET name=?,roll_number=? WHERE id=?").run(name,roll,id);
    if(req.body.password) db.prepare("UPDATE students SET password=? WHERE id=?").run(hash(req.body.password),id);
    res.json({ok:true,student:safeStudent(db.prepare("SELECT * FROM students WHERE id=?").get(id))});
  }catch(e){res.status(400).json({error:"Roll number already exists"});}
});

app.delete("/api/faculty/students/:id",facultyRequired,(req,res)=>{
  const id=Number(req.params.id);
  db.prepare("DELETE FROM attendance WHERE student_id=?").run(id);
  const r=db.prepare("DELETE FROM students WHERE id=?").run(id);
  if(!r.changes) return res.status(404).json({error:"Student not found"});
  res.json({ok:true});
});

app.get("/api/faculty/students/:id/attendance",facultyRequired,(req,res)=>{
  const id=Number(req.params.id);
  const s=db.prepare("SELECT id,name,roll_number FROM students WHERE id=?").get(id);
  if(!s) return res.status(404).json({error:"Student not found"});
  const history=db.prepare("SELECT id,attendance_date,status,marked_at FROM attendance WHERE student_id=? ORDER BY attendance_date DESC").all(id);
  res.json({student:s,history});
});

app.put("/api/faculty/attendance/:id",facultyRequired,(req,res)=>{
  const status=req.body.status==="Absent"?"Absent":"Present";
  const r=db.prepare("UPDATE attendance SET status=? WHERE id=?").run(status,Number(req.params.id));
  if(!r.changes) return res.status(404).json({error:"Attendance record not found"});
  res.json({ok:true});
});

app.delete("/api/faculty/attendance/:id",facultyRequired,(req,res)=>{
  const r=db.prepare("DELETE FROM attendance WHERE id=?").run(Number(req.params.id));
  if(!r.changes) return res.status(404).json({error:"Attendance record not found"});
  res.json({ok:true});
});

app.get("/api/faculty/overview",facultyRequired,(req,res)=>{
  const students=db.prepare("SELECT COUNT(*) c FROM students").get().c;
  const markedToday=db.prepare("SELECT COUNT(*) c FROM attendance WHERE attendance_date=?").get(today()).c;
  res.json({students,markedToday,date:today()});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>console.log(`AttendEase running on ${PORT}, DB: ${DB_PATH}`));
