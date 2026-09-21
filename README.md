# AttendEase — Day-wise Attendance

A complete multi-user attendance website.

## What it does
- Student login with name + roll number (roll number is the initial password).
- Every student gets their own profile.
- A student can mark ONLY their own attendance.
- Attendance is DAY-WISE, not subject-wise.
- One attendance record per student per date.
- Automatic Present, Absent, Total and Percentage calculation.
- Each student sees only their own detailed attendance history.
- A class overview shows everyone's aggregate attendance (Present / Absent / Total / %).
- Faculty/admin can add students and see/manage class attendance.
- Passwords are stored as bcrypt hashes, not plain text.
- SQLite database is created automatically.

## Run
1. Install Node.js 18+ on the computer/server.
2. Extract this folder.
3. Open a terminal inside the folder.
4. Run:
   npm install
   npm start
5. Open:
   http://localhost:3000

For phones on the same Wi-Fi, open:
http://YOUR-COMPUTER-IP:3000

IMPORTANT: localhost on another phone means that phone itself. To make the site available from anywhere, deploy this Node project to a server/hosting service.

## Demo accounts
Student:
Username: Manikanta
Password: 23A81A0501

Student:
Username: Jaswanth
Password: 23A81A0502

Admin:
Username: admin
Password: admin123

The first time the server starts, these demo users are created automatically.

## Production note
For a real college deployment:
- Change the JWT secret in environment variable JWT_SECRET.
- Change/remove the demo admin password.
- Use HTTPS.
- Require students to change their initial password.
- Back up the database.


## Render deployment
Build Command: npm install
Start Command: npm start
Node: 22.x
