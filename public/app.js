const $ = s => document.querySelector(s);

let mode = "student";

$("#studentTab").onclick = () => {
  mode = "student";
  $("#studentTab").classList.add("on");
  $("#adminTab").classList.remove("on");
  $("#name").placeholder = "Your name";
  $("#pass").placeholder = "Roll number";
};

$("#adminTab").onclick = () => {
  mode = "faculty";
  $("#adminTab").classList.add("on");
  $("#studentTab").classList.remove("on");
  $("#name").placeholder = "Faculty ID";
  $("#pass").placeholder = "Faculty password";
};

$("#login").onsubmit = async e => {
  e.preventDefault();
  $("#err").textContent = "";

  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: mode,
        username: $("#name").value.trim(),
        password: $("#pass").value
      })
    });

    const d = await r.json();

    if (!r.ok) {
      $("#err").textContent = d.error || "Login failed";
      return;
    }

    if (mode === "faculty") {
      location.href = "/admin.html";
    } else {
      location.href = "/dashboard.html";
    }

  } catch (err) {
    console.error(err);
    $("#err").textContent = "Server connection failed. Please try again.";
  }
};
