const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const db = new Database(path.join(__dirname, "attendance.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  student_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  roll_number TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Present','Absent')),
  marked_time TEXT NOT NULL,
  FOREIGN KEY(student_id) REFERENCES students(student_id),
  UNIQUE(student_id, date)
);

CREATE TABLE IF NOT EXISTS admins (
  admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
`);

// Create default admin account if it does not exist.
const admin = db
  .prepare("SELECT admin_id FROM admins WHERE username=?")
  .get("admin");

if (!admin) {
  db.prepare(
    "INSERT INTO admins(username,password_hash) VALUES(?,?)"
  ).run("admin", bcrypt.hashSync("admin123", 10));
}

// Demo students
function seedStudent(name, roll) {
  const exists = db
    .prepare("SELECT student_id FROM students WHERE roll_number=?")
    .get(roll);

  if (!exists) {
    db.prepare(
      "INSERT INTO students(name,roll_number,password_hash) VALUES(?,?,?)"
    ).run(name, roll, bcrypt.hashSync(roll, 10));
  }
}

seedStudent("Manikanta", "23A81A0501");
seedStudent("Jaswanth", "23A81A0502");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-secret-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

// Authentication middleware
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Please login."
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (
    !req.session.user ||
    req.session.user.role !== "admin"
  ) {
    return res.status(403).json({
      error: "Admin access required."
    });
  }

  next();
}

// Student attendance statistics
function getStats(studentId) {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN status='Present' THEN 1
            ELSE 0
          END
        ) AS present,
        SUM(
          CASE
            WHEN status='Absent' THEN 1
            ELSE 0
          END
        ) AS absent
      FROM attendance
      WHERE student_id=?
    `)
    .get(studentId);

  const total = Number(row.total || 0);
  const present = Number(row.present || 0);
  const absent = Number(row.absent || 0);

  const percentage = total
    ? +(present / total * 100).toFixed(2)
    : 0;

  // Number of consecutive future classes needed
  // to reach 75% attendance.
  let needed = 0;

  while (
    total + needed > 0 &&
    ((present + needed) / (total + needed)) * 100 < 75
  ) {
    needed++;
  }

  return {
    total,
    present,
    absent,
    percentage,
    needed
  };
}

// Validate YYYY-MM-DD date
function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

// =========================
// LOGIN
// =========================

app.post("/api/login", (req, res) => {
  const {
    username,
    password,
    role
  } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required."
    });
  }

  // Admin login
  if (role === "admin") {
    const a = db
      .prepare(
        "SELECT * FROM admins WHERE username=?"
      )
      .get(username);

    if (
      !a ||
      !bcrypt.compareSync(
        password,
        a.password_hash
      )
    ) {
      return res.status(401).json({
        error: "Invalid admin login."
      });
    }

    req.session.user = {
      role: "admin",
      id: a.admin_id,
      name: a.username
    };

    return res.json({
      ok: true,
      role: "admin"
    });
  }

  // Student login
  const s = db
    .prepare(
      `
      SELECT *
      FROM students
      WHERE name=? COLLATE NOCASE
         OR roll_number=?
      `
    )
    .get(username, username);

  if (
    !s ||
    !bcrypt.compareSync(
      password,
      s.password_hash
    )
  ) {
    return res.status(401).json({
      error: "Invalid name or roll number."
    });
  }

  req.session.user = {
    role: "student",
    id: s.student_id,
    name: s.name
  };

  res.json({
    ok: true,
    role: "student"
  });
});

// =========================
// LOGOUT
// =========================

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

// =========================
// CURRENT USER
// =========================

app.get("/api/me", requireLogin, (req, res) => {
  if (req.session.user.role === "admin") {
    return res.json({
      role: "admin",
      name: req.session.user.name
    });
  }

  const s = db
    .prepare(
      `
      SELECT student_id,name,roll_number
      FROM students
      WHERE student_id=?
      `
    )
    .get(req.session.user.id);

  if (!s) {
    return res.status(404).json({
      error: "Student not found."
    });
  }

  res.json({
    role: "student",
    student: s,
    stats: getStats(s.student_id)
  });
});

// =========================
// STUDENT MARK ATTENDANCE
// =========================

app.post("/api/attendance", requireLogin, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.status(403).json({
      error: "Students only."
    });
  }

  const date = String(req.body.date || "");
  const status = String(req.body.status || "");

  if (
    !validDate(date) ||
    !["Present", "Absent"].includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid attendance data."
    });
  }

  // Prevent duplicate attendance for same student/date
  const old = db
    .prepare(
      `
      SELECT attendance_id
      FROM attendance
      WHERE student_id=? AND date=?
      `
    )
    .get(
      req.session.user.id,
      date
    );

  if (old) {
    return res.status(409).json({
      error:
        "Attendance is already marked for this date."
    });
  }

  try {
    db.prepare(
      `
      INSERT INTO attendance(
        student_id,
        date,
        status,
        marked_time
      )
      VALUES(?,?,?,?)
      `
    ).run(
      req.session.user.id,
      date,
      status,
      new Date().toISOString()
    );

    res.json({
      ok: true,
      stats: getStats(
        req.session.user.id
      )
    });
  } catch (error) {
    // Extra protection against duplicate attendance
    if (
      String(error.message).includes("UNIQUE")
    ) {
      return res.status(409).json({
        error:
          "Attendance is already marked for this date."
      });
    }

    res.status(500).json({
      error: "Could not save attendance."
    });
  }
});

// =========================
// STUDENT ATTENDANCE HISTORY
// =========================

app.get("/api/attendance", requireLogin, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.status(403).json({
      error: "Students only."
    });
  }

  const rows = db
    .prepare(
      `
      SELECT
        attendance_id,
        date,
        status,
        marked_time
      FROM attendance
      WHERE student_id=?
      ORDER BY date DESC
      `
    )
    .all(req.session.user.id);

  res.json({
    rows,
    stats: getStats(
      req.session.user.id
    )
  });
});

// =========================
// CLASS OVERVIEW
// Aggregate only
// =========================

app.get("/api/overview", requireLogin, (req, res) => {
  const students = db
    .
