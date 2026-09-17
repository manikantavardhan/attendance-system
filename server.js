const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_FOR_PRODUCTION";

const db = new Database(path.join(__dirname, "attendance.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* =========================
   DATABASE TABLES
========================= */

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

/* =========================
   SEED / UPDATE DEFAULT USERS
========================= */

function seed() {
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM students")
    .get().c;

  // First installation
  if (count === 0) {
    const add = db.prepare(`
      INSERT INTO students
      (name, roll_number, password_hash)
      VALUES (?, ?, ?)
    `);

    add.run(
      "Manikanta",
      "25Q71AO521",
      bcrypt.hashSync("25Q71AO521", 10)
    );

    add.run(
      "Jaswanth",
      "23A81A0502",
      bcrypt.hashSync("23A81A0502", 10)
    );
  } else {
    /*
      Existing Render database:
      Change Manikanta's old roll number
      without deleting his attendance.
    */

    const manikanta = db
      .prepare("SELECT * FROM students WHERE name = ?")
      .get("Manikanta");

    if (manikanta) {
      if (manikanta.roll_number !== "25Q71AO521") {
        try {
          db.prepare(`
            UPDATE students
            SET roll_number = ?
            WHERE id = ?
          `).run("25Q71AO521", manikanta.id);

          /*
            Only update password if the old password
            was still the original roll number.
          */
          const oldPasswordStillWorks = bcrypt.compareSync(
            "23A81A0501",
            manikanta.password_hash
          );

          if (oldPasswordStillWorks) {
            db.prepare(`
              UPDATE students
              SET password_hash = ?
              WHERE id = ?
            `).run(
              bcrypt.hashSync("25Q71AO521", 10),
              manikanta.id
            );
          }

          console.log(
            "Manikanta roll number updated to 25Q71AO521"
          );
        } catch (e) {
          console.log(
            "Could not update Manikanta:",
            e.message
          );
        }
      }
    }
  }
}

seed();

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());
app.use(cookieParser());

app.use(
  express.static(path.join(__dirname, "public"))
);

/* =========================
   AUTH FUNCTIONS
========================= */

function sign(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      roll: user.roll_number,
      role: "student"
    },
    JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

function auth(req, res, next) {
  try {
    const token = req.cookies.attendease;

    if (!token) {
      return res.status(401).json({
        error: "Please login."
      });
    }

    req.user = jwt.verify(token, JWT_SECRET);

    next();
  } catch (e) {
    return res.status(401).json({
      error: "Session expired. Please login again."
    });
  }
}

function admin(req, res, next) {
  const value = req.cookies.admin_attendease;

  if (value !== "1") {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  next();
}

/* =========================
   DATE FUNCTIONS
========================= */

function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================
   STUDENT LOGIN
========================= */

app.post("/api/login", (req, res) => {
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");

  if (!name || !password) {
    return res.status(400).json({
      error: "Enter username and password."
    });
  }

  const user = db
    .prepare(`
      SELECT *
      FROM students
      WHERE name = ?
    `)
    .get(name);

  if (
    !user ||
    !bcrypt.compareSync(password, user.password_hash)
  ) {
    return res.status(401).json({
      error: "Invalid username or password."
    });
  }

  res.cookie(
    "attendease",
    sign(user),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  );

  res.json({
    ok: true,
    user: {
      name: user.name,
      roll: user.roll_number
    }
  });
});

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin-login", (req, res) => {
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");

  const adminName =
    process.env.ADMIN_USER || "admin";

  const adminPassword =
    process.env.ADMIN_PASSWORD || "admin123";

  if (
    name === adminName &&
    password === adminPassword
  ) {
    res.cookie(
      "admin_attendease",
      "1",
      {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
      }
    );

    return res.json({
      ok: true
    });
  }

  return res.status(401).json({
    error: "Invalid admin login."
  });
});

/* =========================
   LOGOUT
========================= */

app.post("/api/logout", (req, res) => {
  res.clearCookie("attendease");
  res.clearCookie("admin_attendease");

  res.json({
    ok: true
  });
});

/* =========================
   STUDENT SUMMARY
========================= */

function summary(studentId) {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS total,

        COALESCE(
          SUM(
            CASE
              WHEN status = 'Present'
              THEN 1
              ELSE 0
            END
          ),
          0
        ) AS present,

        COALESCE(
          SUM(
            CASE
              WHEN status = 'Absent'
              THEN 1
              ELSE 0
            END
          ),
          0
        ) AS absent

      FROM attendance

      WHERE student_id = ?
    `)
    .get(studentId);

  const percentage = row.total
    ? Number(
        (
          (row.present / row.total) *
          100
        ).toFixed(2)
      )
    : 0;

  return {
    total: row.total,
    present: row.present,
    absent: row.absent,
    percentage
  };
}

/* =========================
   CURRENT STUDENT
========================= */

app.get("/api/me", auth, (req, res) => {
  const student = db
    .prepare(`
      SELECT
        id,
        name,
        roll_number
      FROM students
      WHERE id = ?
    `)
    .get(req.user.id);

  if (!student) {
    return res.status(401).json({
      error: "Student not found."
    });
  }

  res.json({
    user: {
      name: student.name,
      roll: student.roll_number
    },

    summary: summary(student.id)
  });
});

/* =========================
   MY ATTENDANCE HISTORY
========================= */

app.get(
  "/api/my-attendance",
  auth,
  (req, res) => {
    const rows = db
      .prepare(`
        SELECT
          attendance_date,
          status,
          marked_at

        FROM attendance

        WHERE student_id = ?

        ORDER BY attendance_date DESC
      `)
      .all(req.user.id);

    res.json({
      rows
    });
  }
);

/* =========================
   CHECK TODAY ATTENDANCE
========================= */

app.get(
  "/api/today-attendance",
  auth,
  (req, res) => {
    const today = todayDate();

    const row = db
      .prepare(`
        SELECT
          attendance_date,
          status,
          marked_at

        FROM attendance

        WHERE student_id = ?
        AND attendance_date = ?
      `)
      .get(req.user.id, today);

    res.json({
      marked: !!row,
      attendance: row || null,
      date: today
    });
  }
);

/* =========================
   MARK TODAY ATTENDANCE
========================= */

app.post(
  "/api/my-attendance",
  auth,
  (req, res) => {
    const status = String(
      req.body.status || ""
    );

    if (!["Present", "Absent"].includes(status)) {
      return res.status(400).json({
        error: "Invalid attendance status."
      });
    }

    const today = todayDate();

    try {
      db.prepare(`
        INSERT INTO attendance
        (
          student_id,
          attendance_date,
          status
        )
        VALUES (?, ?, ?)
      `).run(
        req.user.id,
        today,
        status
      );

      res.json({
        ok: true,
        message:
          `Today's attendance marked as ${status}.`,
        summary: summary(req.user.id)
      });
    } catch (e) {
      if (
        String(e.message).includes("UNIQUE")
      ) {
        return res.status(409).json({
          error:
            "Attendance is already marked for today."
        });
      }

      console.log(e);

      return res.status(500).json({
        error:
          "Could not save attendance."
      });
    }
  }
);

/* =========================
   CLASS OVERVIEW
   Everyone can see aggregate only
========================= */

app.get(
  "/api/class-overview",
  auth,
  (req, res) => {
    const students = db
      .prepare(`
        SELECT
          id,
          name,
          roll_number
        FROM students

        ORDER BY name
      `)
      .all();

    res.json({
      students: students.map((student) => ({
        name: student.name,
        roll: student.roll_number,
        ...summary(student.id)
      }))
    });
  }
);

/* =========================
   STUDENT CHANGE PASSWORD
========================= */

app.post(
  "/api/change-password",
  auth,
  (req, res) => {
    const oldPassword = String(
      req.body.oldPassword || ""
    );

    const newPassword = String(
      req.body.newPassword || ""
    );

    if (newPassword.length < 6) {
      return res.status(400).json({
        error:
          "New password must be at least 6 characters."
      });
    }

    const student = db
      .prepare(`
        SELECT *
        FROM students
        WHERE id = ?
      `)
      .get(req.user.id);

    if (!student) {
      return res.status(404).json({
        error: "Student not found."
      });
    }

    if (
      !bcrypt.compareSync(
        oldPassword,
        student.password_hash
      )
    ) {
      return res.status(401).json({
        error:
          "Current password is incorrect."
      });
    }

    const newHash =
      bcrypt.hashSync(newPassword, 10);

    db.prepare(`
      UPDATE students

      SET password_hash = ?

      WHERE id = ?
    `).run(
      newHash,
      student.id
    );

    res.json({
      ok: true,
      message:
        "Password changed successfully."
    });
  }
);

/* =========================
   ADMIN PAGE
========================= */

app.get(
  "/admin",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

/* =========================
   ADMIN STUDENT LIST
========================= */

app.get(
  "/api/admin/students",
  admin,
  (req, res) => {
    const rows = db
      .prepare(`
        SELECT
          id,
          name,
          roll_number,
          created_at

        FROM students

        ORDER BY name
      `)
      .all();

    res.json({
      rows
    });
  }
);

/* =========================
   ADMIN ADD STUDENT
========================= */

app.post(
  "/api/admin/students",
  admin,
  (req, res) => {
    const name = String(
      req.body.name || ""
    ).trim();

    const roll = String(
      req.body.roll || ""
    ).trim();

    const password = String(
      req.body.password || roll
    );

    if (
      !name ||
      !roll ||
      password.length < 6
    ) {
      return res.status(400).json({
        error:
          "Name, roll number and a password of at least 6 characters are required."
      });
    }

    try {
      db.prepare(`
        INSERT INTO students
        (
          name,
          roll_number,
          password_hash
        )

        VALUES (?, ?, ?)
      `).run(
        name,
        roll,
        bcrypt.hashSync(
          password,
          10
        )
      );

      res.json({
        ok: true,
        message:
          "Student added successfully."
      });
    } catch (e) {
      if (
        String(e.message).includes("UNIQUE")
      ) {
        return res.status(409).json({
          error:
            "That roll number already exists."
        });
      }

      res.status(500).json({
        error:
          "Could not add student."
      });
    }
  }
);

/* =========================
   ADMIN EDIT STUDENT
========================= */

app.patch(
  "/api/admin/students/:id",
  admin,
  (req, res) => {
    const id = Number(
      req.params.id
    );

    const name = String(
      req.body.name || ""
    ).trim();

    const roll = String(
      req.body.roll || ""
    ).trim();

    if (
      !id ||
      !name ||
      !roll
    ) {
      return res.status(400).json({
        error:
          "Name and roll number are required."
      });
    }

    try {
      const result = db
        .prepare(`
          UPDATE students

          SET
            name = ?,
            roll_number = ?

          WHERE id = ?
        `)
        .run(
          name,
          roll,
          id
        );

      if (result.changes === 0) {
        return res.status(404).json({
          error:
            "Student not found."
        });
      }

      res.json({
        ok: true,
        message:
          "Student updated successfully."
      });
    } catch (e) {
      if (
        String(e.message).includes("UNIQUE")
      ) {
        return res.status(409).json({
          error:
            "That roll number already exists."
        });
      }

      res.status(500).json({
        error:
          "Could not update student."
      });
    }
  }
);

/* =========================
   ADMIN DELETE STUDENT
========================= */

app.delete(
  "/api/admin/students/:id",
  admin,
  (req, res) => {
    const id = Number(
      req.params.id
    );

    if (!id) {
      return res.status(400).json({
        error: "Invalid student ID."
      });
    }

    const result = db
      .prepare(`
        DELETE FROM students
        WHERE id = ?
      `)
      .run(id);

    if (result.changes === 0) {
      return res.status(404).json({
        error:
          "Student not found."
      });
    }

    res.json({
      ok: true,
      message:
        "Student deleted successfully."
    });
  }
);

/* =========================
   ADMIN ALL ATTENDANCE
========================= */

app.get(
  "/api/admin/attendance",
  admin,
  (req, res) => {
    const rows = db
      .prepare(`
        SELECT
          a.id,
          a.attendance_date,
          a.status,
          a.marked_at,
          s.name,
          s.roll_number

        FROM attendance a

        JOIN students s
        ON s.id = a.student_id

        ORDER BY
          a.attendance_date DESC,
          s.name
      `)
      .all();

    res.json({
      rows
    });
  }
);

/* =========================
   ADMIN EDIT ATTENDANCE
========================= */

app.patch(
  "/api/admin/attendance/:id",
  admin,
  (req, res) => {
    const status = String(
      req.body.status || ""
    );

    if (
      !["Present", "Absent"].includes(
        status
      )
    ) {
      return res.status(400).json({
        error:
          "Invalid attendance status."
      });
    }

    const result = db
      .prepare(`
        UPDATE attendance

        SET status = ?

        WHERE id = ?
      `)
      .run(
        status,
        req.params.id
      );

    if (result.changes === 0) {
      return res.status(404).json({
        error:
          "Attendance record not found."
      });
    }

    res.json({
      ok: true,
      message:
        "Attendance updated."
    });
  }
);

/* =========================
   ADMIN OVERVIEW
========================= */

app.get(
  "/api/admin/overview",
  admin,
  (req, res) => {
    const students = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM students
      `)
      .get().count;

    const presentRecords = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM attendance
        WHERE status = 'Present'
      `)
      .get().count;

    const absentRecords = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM attendance
        WHERE status = 'Absent'
      `)
      .get().count;

    const markedDays = db
      .prepare(`
        SELECT COUNT(
          DISTINCT attendance_date
        ) AS count

        FROM attendance
      `)
      .get().count;

    res.json({
      students,
      presentRecords,
      absentRecords,
      markedDays
    });
  }
);

/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "AttendEase Attendance System"
    });
  }
);

/* =========================
   FALLBACK
========================= */

app.use(
  (req, res) => {
    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `AttendEase running on port ${PORT}`
    );
  }
);
