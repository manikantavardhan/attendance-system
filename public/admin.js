async function logout() {
    await fetch("/api/logout", {
        method: "POST"
    });

    location.href = "/";
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, m => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[m]));
}

let studentsData = [];

async function load() {
    try {
        const r = await fetch("/api/class-overview");

        if (!r.ok) {
            location.href = "/";
            return;
        }

        const d = await r.json();

        studentsData = d.students || [];

        const present = studentsData.reduce(
            (a, x) => a + Number(x.present || 0),
            0
        );

        const absent = studentsData.reduce(
            (a, x) => a + Number(x.absent || 0),
            0
        );

        const total = present + absent;

        document.querySelector("#stats").innerHTML = [
            ["Students", studentsData.length],
            ["Present Records", present],
            ["Absent Records", absent],
            ["Attendance Records", total]
        ].map(x => `
            <div class="card">
                <span>${x[0]}</span>
                <b>${x[1]}</b>
            </div>
        `).join("");

        render(studentsData);

    } catch (error) {
        console.error(error);
    }
}

function render(a) {

    const search = document.querySelector("#search");

    const q = (search ? search.value : "").toLowerCase();

    a = a.filter(x =>
        (x.name + " " + x.roll)
            .toLowerCase()
            .includes(q)
    );

    document.querySelector("#table").innerHTML = `
        <div class="table">
            <table>
                <tr>
                    <th>Name</th>
                    <th>Roll</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Total</th>
                    <th>%</th>
                </tr>

                ${a.map(x => `
                    <tr>
                        <td>${esc(x.name)}</td>
                        <td>${esc(x.roll)}</td>
                        <td>${x.present}</td>
                        <td>${x.absent}</td>
                        <td>${x.total}</td>
                        <td>${x.percentage}%</td>
                    </tr>
                `).join("")}
            </table>
        </div>
    `;
}

const searchBox = document.querySelector("#search");

if (searchBox) {
    searchBox.oninput = () => {
        render(studentsData);
    };
}

async function addStudent() {

    const name = document.querySelector("#n").value.trim();
    const roll = document.querySelector("#r").value.trim();
    const password = document.querySelector("#p").value.trim();

    if (!name || !roll || !password) {
        document.querySelector("#msg").textContent =
            "Please fill all fields.";

        return;
    }

    try {

        const r = await fetch("/api/admin/students", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                name: name,
                roll: roll,
                password: password
            })
        });

        const d = await r.json();

        document.querySelector("#msg").textContent =
            r.ok
                ? "Student added successfully."
                : (d.error || "Failed to add student.");

        if (r.ok) {

            document.querySelector("#n").value = "";
            document.querySelector("#r").value = "";
            document.querySelector("#p").value = "";

            load();
        }

    } catch (error) {

        document.querySelector("#msg").textContent =
            "Server error. Please try again.";

        console.error(error);
    }
}

load();
